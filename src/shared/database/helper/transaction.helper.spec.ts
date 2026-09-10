import { FailedToSaveResourceError, TransactionFailedError } from '@error';
import { AppError } from '@types';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { TransactionHelper } from './transaction.helper';

/**
 * A query runner that tracks the transaction state the way a real one does,
 * so `isTransactionActive` flips at the right moments and the nesting test is
 * actually meaningful.
 */
function buildQueryRunner(): QueryRunner & { calls: string[] } {
  const calls: string[] = [];
  const runner = {
    calls,
    isTransactionActive: false,
    manager: {} as EntityManager,
    connect: jest.fn(() => {
      calls.push('connect');
      return Promise.resolve();
    }),
    startTransaction: jest.fn(() => {
      calls.push('start');
      runner.isTransactionActive = true;
      return Promise.resolve();
    }),
    commitTransaction: jest.fn(() => {
      calls.push('commit');
      runner.isTransactionActive = false;
      return Promise.resolve();
    }),
    rollbackTransaction: jest.fn(() => {
      calls.push('rollback');
      runner.isTransactionActive = false;
      return Promise.resolve();
    }),
    release: jest.fn(() => {
      calls.push('release');
      return Promise.resolve();
    }),
  };
  // The fake implements only what TransactionHelper touches.
  runner.manager = { queryRunner: runner } as unknown as EntityManager;
  return runner as unknown as QueryRunner & { calls: string[] };
}

function buildHelper(): {
  helper: TransactionHelper;
  runner: QueryRunner & { calls: string[] };
} {
  const runner = buildQueryRunner();
  const dataSource = { createQueryRunner: () => runner } as unknown as DataSource;
  return { helper: new TransactionHelper(dataSource), runner };
}

describe('TransactionHelper', () => {
  it('commits and returns the value when the work succeeds', async () => {
    const { helper, runner } = buildHelper();

    const result = await helper.start(() => Promise.resolve('saved'));

    expect(result).toBe('saved');
    expect(runner.calls).toEqual(['connect', 'start', 'commit', 'release']);
  });

  it('rolls back when the work returns an AppError, and passes the error through', async () => {
    const { helper, runner } = buildHelper();
    const failure = new FailedToSaveResourceError('Subscription');

    const result = await helper.start(() => Promise.resolve(failure));

    // This is the seam between errors-as-values and the database: nobody
    // threw, and the transaction still came undone.
    expect(result).toBe(failure);
    expect(runner.calls).toEqual(['connect', 'start', 'rollback', 'release']);
  });

  it('rolls back and returns TransactionFailedError when the work throws', async () => {
    const { helper, runner } = buildHelper();
    const cause = new Error('deadlock detected');

    const result = await helper.start(() => Promise.reject(cause));

    expect(result).toBeInstanceOf(TransactionFailedError);
    expect(result.cause).toBe(cause);
    expect(runner.calls).toEqual(['connect', 'start', 'rollback', 'release']);
  });

  it('releases the connection even when the commit itself fails', async () => {
    const { helper, runner } = buildHelper();
    jest
      .spyOn(runner, 'commitTransaction')
      .mockRejectedValueOnce(new Error('connection terminated'));

    const result = await helper.start(() => Promise.resolve('value'));

    expect(result).toBeInstanceOf(TransactionFailedError);
    // A leaked connection here is the bug that only shows up an hour later,
    // under load, as a pool exhaustion.
    expect(runner.calls).toContain('release');
  });

  it('joins the outer transaction instead of opening a second one', async () => {
    const { helper, runner } = buildHelper();

    const result = await helper.start(async () => {
      const inner = await helper.start(() => Promise.resolve('inner'));
      return `outer:${inner instanceof AppError ? inner.type : inner}`;
    });

    expect(result).toBe('outer:inner');
    // One begin, one commit — the inner call did neither.
    expect(runner.calls).toEqual(['connect', 'start', 'commit', 'release']);
  });

  it('lets an inner AppError roll back the whole outer transaction', async () => {
    const { helper, runner } = buildHelper();
    const failure = new FailedToSaveResourceError('Delivery');

    const result = await helper.start(() => helper.start(() => Promise.resolve(failure)));

    expect(result).toBe(failure);
    expect(runner.calls).toEqual(['connect', 'start', 'rollback', 'release']);
  });

  it('exposes the transaction manager only while a transaction is open', async () => {
    const { helper } = buildHelper();

    expect(helper.manager).toBeNull();
    expect(helper.isInTransaction()).toBe(false);

    await helper.start(() => {
      expect(helper.isInTransaction()).toBe(true);
      expect(helper.manager).not.toBeNull();
      return Promise.resolve('ok');
    });

    // The AsyncLocalStorage context ends with the callback — a later caller
    // on the same singleton must not see a stale manager.
    expect(helper.manager).toBeNull();
    expect(helper.isInTransaction()).toBe(false);
  });

  it('keeps concurrent transactions isolated from each other', async () => {
    // Two independent runners, one helper — the case a request-scoped
    // implementation gets right by construction and a naive singleton with a
    // single `_manager` field gets wrong.
    const runners = [buildQueryRunner(), buildQueryRunner()];
    let handed = 0;
    const dataSource = {
      createQueryRunner: () => runners[handed++],
    } as unknown as DataSource;
    const helper = new TransactionHelper(dataSource);

    const seen: (EntityManager | null)[] = [];
    await Promise.all([
      helper.start(async () => {
        await Promise.resolve();
        seen.push(helper.manager);
        return 'a';
      }),
      helper.start(() => {
        seen.push(helper.manager);
        return Promise.resolve('b');
      }),
    ]);

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(runners[0]?.calls).toEqual(['connect', 'start', 'commit', 'release']);
    expect(runners[1]?.calls).toEqual(['connect', 'start', 'commit', 'release']);
  });
});
