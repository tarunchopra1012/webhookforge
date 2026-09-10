import { TransactionHelper } from '@helper';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FailedToFetchResourceError, ResourceNotFoundError } from '@error';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { BaseRepository } from './base.repository';

class ProbePersistence {
  id!: string;
  tenantId!: string;
  name!: string;
}

/**
 * Stands in for a real adapter. Note it declares **no constructor** — that is
 * the pattern every repository in this codebase uses, and the reason the DI
 * test below exists.
 */
@Injectable()
class ProbeRepository extends BaseRepository<ProbePersistence> {
  protected model = ProbePersistence;

  // The base methods are protected because they speak persistence types.
  // A test double may widen them; a real adapter maps instead.
  findOneRow(id: string) {
    return this.findOne({ where: { id } }, 'Probe');
  }

  deleteRow(id: string) {
    return this.delete({ id }, 'Probe');
  }

  repository() {
    return this.getDBRepository();
  }
}

function buildTypeOrmRepository(): jest.Mocked<Repository<ProbePersistence>> {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    softDelete: jest.fn(),
  } as unknown as jest.Mocked<Repository<ProbePersistence>>;
}

describe('BaseRepository', () => {
  let ormRepository: jest.Mocked<Repository<ProbePersistence>>;
  let dataSource: DataSource;
  let transactionHelper: TransactionHelper;
  let repository: ProbeRepository;

  beforeEach(async () => {
    ormRepository = buildTypeOrmRepository();
    dataSource = {
      getRepository: jest.fn().mockReturnValue(ormRepository),
    } as unknown as DataSource;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProbeRepository,
        TransactionHelper,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    repository = moduleRef.get(ProbeRepository);
    transactionHelper = moduleRef.get(TransactionHelper);
  });

  it('resolves its inherited dependencies through Nest without declaring a constructor', () => {
    // TypeScript only emits design:paramtypes for a class that declares a
    // constructor, so Nest finds BaseRepository's parameters by walking the
    // prototype chain. If that ever stops working, every repository in the
    // codebase fails to instantiate at boot — hence the explicit test.
    expect(repository).toBeInstanceOf(ProbeRepository);
    expect(repository.repository()).toBe(ormRepository);
  });

  it('routes queries through the transaction manager while a transaction is open', () => {
    const bound = buildTypeOrmRepository();
    const withRepository = jest.fn().mockReturnValue(bound);
    const manager = { withRepository } as unknown as EntityManager;

    jest.spyOn(transactionHelper, 'isInTransaction').mockReturnValue(true);
    jest.spyOn(transactionHelper, 'manager', 'get').mockReturnValue(manager);

    // A write that used the plain pool repository here would commit outside
    // the surrounding transaction and survive its rollback.
    expect(repository.repository()).toBe(bound);
    expect(withRepository).toHaveBeenCalledWith(ormRepository);
  });

  it('returns the row when one matches', async () => {
    const row = { id: 'a', tenantId: 't', name: 'probe' };
    ormRepository.findOne.mockResolvedValue(row);

    await expect(repository.findOneRow('a')).resolves.toBe(row);
  });

  it('reports a miss as ResourceNotFoundError rather than null', async () => {
    ormRepository.findOne.mockResolvedValue(null);

    const result = await repository.findOneRow('missing');

    expect(result).toBeInstanceOf(ResourceNotFoundError);
    expect((result as ResourceNotFoundError).message).toBe('Probe not found');
  });

  it('converts a driver failure into an AppError instead of throwing', async () => {
    const cause = new Error('connection terminated unexpectedly');
    ormRepository.findOne.mockRejectedValue(cause);

    const result = await repository.findOneRow('a');

    expect(result).toBeInstanceOf(FailedToFetchResourceError);
    expect((result as FailedToFetchResourceError).cause).toBe(cause);
    // 'External' is what separates "our bug" from "Postgres is unhappy" in
    // the logs.
    expect((result as FailedToFetchResourceError).source).toBe('External');
  });

  it('reports how many rows a delete removed', async () => {
    ormRepository.delete.mockResolvedValue({ affected: 0, raw: [] });

    // Zero means the row was not there, or belongs to another tenant — the
    // caller needs to tell those apart from a successful delete.
    await expect(repository.deleteRow('a')).resolves.toBe(0);
  });
});
