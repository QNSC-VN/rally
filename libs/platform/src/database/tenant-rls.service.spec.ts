import { Test, TestingModule } from '@nestjs/testing';
import { TenantRlsService } from './tenant-rls.service';
import { DRIZZLE } from './drizzle.provider';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const makeDb = () => {
  const tx = {
    execute: vi.fn().mockResolvedValue(undefined),
  };

  return {
    transaction: vi.fn().mockImplementation(async (fn: (tx: typeof tx) => unknown) => fn(tx)),
    _tx: tx,
  };
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TenantRlsService', () => {
  let service: TenantRlsService;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    db = makeDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TenantRlsService, { provide: DRIZZLE, useValue: db }],
    }).compile();

    service = module.get(TenantRlsService);
  });

  it('opens a transaction', async () => {
    await service.withTenantContext('tenant-1', async () => 'ok');
    expect(db.transaction).toHaveBeenCalledOnce();
  });

  it('calls SET LOCAL app.tenant_id before executing fn', async () => {
    const calls: string[] = [];
    db._tx.execute.mockImplementation(async (query: ReturnType<typeof sql>) => {
      calls.push(JSON.stringify(query));
    });

    await service.withTenantContext('tenant-uuid-1234', async () => 'result');

    expect(db._tx.execute).toHaveBeenCalledOnce();
    const call = JSON.stringify(db._tx.execute.mock.calls[0]);
    expect(call).toContain('tenant-uuid-1234');
  });

  it('returns the result of fn', async () => {
    const result = await service.withTenantContext('tenant-1', async () => ({ count: 42 }));
    expect(result).toEqual({ count: 42 });
  });

  it('propagates errors from fn through the transaction', async () => {
    await expect(
      service.withTenantContext('tenant-1', async () => {
        throw new Error('query failed');
      }),
    ).rejects.toThrow('query failed');
  });
});
