import { AsyncLocalStorage } from 'node:async_hooks';
import { TransactionFailedError } from '@error';
import { LogService } from '@logger';
import { Injectable } from '@nestjs/common';
import { AppError } from '@types';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

interface TransactionContext {
  manager: EntityManager;
}

/**
 * Runs work inside a database transaction and makes the transaction's
 * `EntityManager` reachable by every repository underneath it, without
 * threading it through a dozen method signatures.
 *
 * ## Why AsyncLocalStorage and not a request-scoped provider
 *
 * The reference codebase makes this class request-scoped (`nj-request-scope`),
 * which has two problems here:
 *
 *  1. **Request scope is contagious.** Anything that injects a request-scoped
 *     provider becomes request-scoped too — so every repository, and every
 *     use case holding one, would be re-instantiated per request. That is a
 *     real cost on the ingest path, which is the hot path.
 *  2. **A delivery worker has no request.** BullMQ jobs and the retry sweeper
 *     are where transactions matter most in this service, and there is no
 *     HTTP request to scope to. A request-scoped helper is simply the wrong
 *     shape for half the callers.
 *
 * `AsyncLocalStorage` is a Node built-in that carries a value along the async
 * call chain regardless of what started it — an HTTP request, a queue job, a
 * cron tick. So this stays a plain singleton and works identically in all
 * three.
 *
 * The cost is that the context is implicit: reading `getDBRepository()` you
 * cannot see *why* it is transactional. That is the same trade-off the
 * request-scoped version makes, and the alternative — passing an
 * `EntityManager` down through ports — would put a TypeORM type on the
 * domain's own interfaces, which the architecture forbids outright.
 */
@Injectable()
export class TransactionHelper {
  private readonly logger = new LogService(TransactionHelper.name);
  private readonly storage = new AsyncLocalStorage<TransactionContext>();

  constructor(private readonly dataSource: DataSource) {}

  /** The active transaction's manager, or null outside a transaction. */
  get manager(): EntityManager | null {
    return this.storage.getStore()?.manager ?? null;
  }

  get queryRunner(): QueryRunner | null {
    return this.manager?.queryRunner ?? null;
  }

  isInTransaction(): boolean {
    return this.queryRunner?.isTransactionActive === true;
  }

  /**
   * Runs `work` in a transaction and commits, unless it returns an `AppError`
   * or throws — either rolls back.
   *
   * Returning an `AppError` rolling the transaction back is the point where
   * errors-as-values meets the database: a UseCase that returns
   * `new SubscriptionAlreadyExistsError()` half way through undoes its own
   * writes without anybody throwing.
   *
   * A **nested** call joins the transaction already in progress rather than
   * opening a second one. The inner call does not commit or roll back — the
   * outermost owner does, once, when it sees the returned value.
   *
   * This never throws. A driver-level failure comes back as
   * `TransactionFailedError` with the original attached as `cause`, so the
   * caller checks it like any other error value. The trade-off is that the
   * original exception type is not visible at the call site; it is logged
   * here in full.
   */
  async start<T>(
    work: () => Promise<T>,
    isolationLevel?: IsolationLevel,
  ): Promise<T | AppError> {
    if (this.isInTransaction()) {
      return work();
    }

    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction(isolationLevel);

      const result = await this.storage.run({ manager: queryRunner.manager }, work);

      if (result instanceof AppError) {
        await queryRunner.rollbackTransaction();
      } else {
        await queryRunner.commitTransaction();
      }

      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        // A rollback can itself fail if the connection is gone. Log it and
        // report the original failure, which is the more useful one.
        await queryRunner.rollbackTransaction().catch((rollbackError: unknown) => {
          this.logger.error(new Error('Rollback failed', { cause: rollbackError }));
        });
      }
      this.logger.error(
        new Error('Transaction failed and was rolled back', { cause: error }),
      );
      return new TransactionFailedError(error);
    } finally {
      // Always returns the connection to the pool. Skipping this under an
      // error path is how a service runs out of connections an hour later.
      await queryRunner.release();
    }
  }
}
