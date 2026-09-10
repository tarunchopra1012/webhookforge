import {
  FailedToDeleteResourceError,
  FailedToFetchResourceError,
  FailedToSaveResourceError,
  ResourceNotFoundError,
} from '@error';
import { TransactionHelper } from '@helper';
import { Injectable } from '@nestjs/common';
import { AppError } from '@types';
import {
  DataSource,
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';

/**
 * The shared half of every TypeORM adapter: transaction awareness, and the
 * four storage primitives wrapped so a driver failure comes back as an
 * `AppError` value instead of an exception.
 *
 * ## These methods are `protected`, on purpose
 *
 * They deal in **persistence entities**. The port a concrete repository
 * implements deals in **domain types**. If these were public they would be
 * part of the adapter's visible surface, and a UseCase holding the port
 * could reach a persistence type through it — exactly the leak the layer
 * rules exist to prevent. A concrete repository calls them and maps the
 * result:
 *
 * ```ts
 * @Injectable()
 * export class SubscriptionRepository
 *   extends BaseRepository<SubscriptionPersistence>
 *   implements SubscriptionRepositoryPort
 * {
 *   protected model = SubscriptionPersistence;
 *
 *   async findById(tenantId: string, id: string): Promise<Subscription | AppError> {
 *     const row = await this.findOne({ where: { tenantId, id } }, 'Subscription');
 *     return row instanceof AppError ? row : SubscriptionMapper.toDomain(row);
 *   }
 * }
 * ```
 *
 * **Naming collision to know about:** a port method with the same name as one
 * of these (`save` is the likely one) will not compile, because TypeScript
 * forbids re-declaring an inherited `protected` member as `public` with a
 * different signature. Name the port method `persist` — or override here —
 * whichever reads better for that aggregate.
 *
 * Subclasses deliberately declare **no constructor**: TypeScript only emits
 * `design:paramtypes` for a class that declares one, so Nest's
 * `Reflect.getMetadata` lookup walks the prototype chain and finds this
 * class's dependencies. Adding a constructor to a subclass means passing
 * `DataSource` and `TransactionHelper` through by hand.
 */
@Injectable()
export abstract class BaseRepository<T extends ObjectLiteral> {
  /** The TypeORM entity this repository is bound to. */
  protected abstract model: new () => T;

  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionHelper: TransactionHelper,
  ) {}

  /**
   * The repository to run queries through.
   *
   * Inside a `TransactionHelper.start()` this is bound to the transaction's
   * `EntityManager`, so the write joins the open transaction and rolls back
   * with it. Outside one it is the plain repository on the pool.
   *
   * Every query in the codebase goes through here. Calling
   * `dataSource.getRepository()` directly is how a write silently escapes the
   * transaction around it.
   */
  protected getDBRepository(): Repository<T> {
    const repository = this.dataSource.getRepository<T>(this.model);
    const manager = this.transactionHelper.manager;

    return this.transactionHelper.isInTransaction() && manager
      ? manager.withRepository(repository)
      : repository;
  }

  /**
   * Returns `ResourceNotFoundError` when nothing matches — absence is a
   * result, not an exception, and callers branch on it with `instanceof`.
   * A concrete repository that wants a domain-specific miss
   * (`SubscriptionNotFoundError`) checks for this and swaps it.
   */
  protected async findOne(
    options: FindOneOptions<T>,
    resource = 'Resource',
  ): Promise<T | AppError> {
    try {
      const row = await this.getDBRepository().findOne(options);
      return row ?? new ResourceNotFoundError(resource);
    } catch (error) {
      return new FailedToFetchResourceError(resource, error);
    }
  }

  protected async findMany(
    options: FindManyOptions<T>,
    resource = 'Resource',
  ): Promise<T[] | AppError> {
    try {
      return await this.getDBRepository().find(options);
    } catch (error) {
      return new FailedToFetchResourceError(resource, error);
    }
  }

  /** The rows for one page plus the unpaged total, in a single round trip. */
  protected async findManyAndCount(
    options: FindManyOptions<T>,
    resource = 'Resource',
  ): Promise<{ rows: T[]; total: number } | AppError> {
    try {
      const [rows, total] = await this.getDBRepository().findAndCount(options);
      return { rows, total };
    } catch (error) {
      return new FailedToFetchResourceError(resource, error);
    }
  }

  protected async count(
    where: FindOptionsWhere<T>,
    resource = 'Resource',
  ): Promise<number | AppError> {
    try {
      return await this.getDBRepository().count({ where });
    } catch (error) {
      return new FailedToFetchResourceError(resource, error);
    }
  }

  /**
   * Insert or update, returning the persisted row with database-generated
   * columns (id, createdAt) filled in.
   */
  protected async save(
    entity: DeepPartial<T>,
    resource = 'Resource',
  ): Promise<T | AppError> {
    try {
      return await this.getDBRepository().save(entity);
    } catch (error) {
      return new FailedToSaveResourceError(resource, error);
    }
  }

  protected async saveMany(
    entities: DeepPartial<T>[],
    resource = 'Resource',
  ): Promise<T[] | AppError> {
    try {
      return await this.getDBRepository().save(entities);
    } catch (error) {
      return new FailedToSaveResourceError(resource, error);
    }
  }

  /**
   * Hard delete. Returns the number of rows removed so a caller can tell
   * "deleted nothing" from "deleted something" — which on a tenant-scoped
   * delete is the difference between a miss and a cross-tenant attempt.
   */
  protected async delete(
    where: FindOptionsWhere<T>,
    resource = 'Resource',
  ): Promise<number | AppError> {
    try {
      const result = await this.getDBRepository().delete(where);
      return result.affected ?? 0;
    } catch (error) {
      return new FailedToDeleteResourceError(resource, error);
    }
  }

  /** Sets `deletedAt`. Only valid on entities with a `@DeleteDateColumn`. */
  protected async softDelete(
    where: FindOptionsWhere<T>,
    resource = 'Resource',
  ): Promise<number | AppError> {
    try {
      const result = await this.getDBRepository().softDelete(where);
      return result.affected ?? 0;
    } catch (error) {
      return new FailedToDeleteResourceError(resource, error);
    }
  }
}
