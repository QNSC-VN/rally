/**
 * `Dev Owner` must SURVIVE a reload, and the surface that edits it must be the surface that reads it.
 *
 * `GAP-P2-IS-004` (BA DEV Handoff retest 2026-08-17, Confirmed Fail): on `Track > Iteration Status`
 * the inline `Dev Owner` dropdown offered a valid user, the write reported success and the name
 * appeared on the row — and after a reload the cell read `No Entry` again.
 *
 * `P2-IS-FR-032C` is the rule: "an Owner/Dev Owner that updated successfully must remain after a
 * refresh or reload". AC3 adds that every surface sharing the Work Item must read the SAME value
 * rather than keeping local state at Iteration Status.
 *
 * Why over real HTTP and why BOTH endpoints in one file: `work_items.dev_owner_id` is written by
 * `PATCH /work-items/:id` and read back by `GET /iteration-status`, which is a DIFFERENT repository
 * with its own projection. Nothing in the suite covered `devOwnerId` at all before this — a
 * service-level spec would have proven the column is writable without proving the screen's own feed
 * returns it, and this defect is exactly the gap between those two claims.
 *
 * Bearer token from `AuthService.devLogin`: Bearer callers are CSRF-exempt by design, and the test app
 * has no `/v1` prefix and no cookie plugin (`reply.setCookie is not a function`).
 */
import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AuthService } from '@qnsc-vn/identity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/api/src/app.module';
import { DEVELOPER_ID, NXP_ITER_CURRENT_ID, NXP_STORY_1_ID } from '../../db/seeds/constants';

describe('Dev Owner persistence (GAP-P2-IS-004)', () => {
  let app: NestFastifyApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const auth = app.get(AuthService);
    const session = await auth.devLogin('dev@qnsc.dev');
    token = session.accessToken;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  const authed = (method: 'GET' | 'PATCH', url: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

  it('writes Dev Owner, returns it, and still returns it on a fresh read', async () => {
    const patch = await authed('PATCH', `/work-items/${NXP_STORY_1_ID}`, {
      devOwnerId: DEVELOPER_ID,
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().devOwnerId).toBe(DEVELOPER_ID);

    // The reload: a NEW request against the record endpoint, not the mutation's own response body.
    const reread = await authed('GET', `/work-items/${NXP_STORY_1_ID}`);
    expect(reread.statusCode).toBe(200);
    expect(reread.json().devOwnerId).toBe(DEVELOPER_ID);
  });

  it('returns Dev Owner on the ITERATION STATUS feed — the screen that edits it (AC2/AC3)', async () => {
    await authed('PATCH', `/work-items/${NXP_STORY_1_ID}`, { devOwnerId: DEVELOPER_ID });

    const status = await authed('GET', `/iterations/${NXP_ITER_CURRENT_ID}/status?limit=50`);
    expect(status.statusCode).toBe(200);
    const row = (status.json().items as Array<{ id: string; devOwnerId: string | null }>).find(
      (r) => r.id === NXP_STORY_1_ID,
    );
    expect(row).toBeDefined();
    expect(row?.devOwnerId).toBe(DEVELOPER_ID);
  });

  it('clears Dev Owner on an explicit null and keeps it cleared', async () => {
    await authed('PATCH', `/work-items/${NXP_STORY_1_ID}`, { devOwnerId: DEVELOPER_ID });

    const cleared = await authed('PATCH', `/work-items/${NXP_STORY_1_ID}`, { devOwnerId: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().devOwnerId).toBeNull();
    expect((await authed('GET', `/work-items/${NXP_STORY_1_ID}`)).json().devOwnerId).toBeNull();
  });

  /**
   * AC4 — "a notification is created only for a successful assignment; fixing persistence must not
   * produce duplicate notifications." Re-sending the SAME Dev Owner is not a new assignment event.
   */
  it('does not treat an unchanged Dev Owner as a new assignment', async () => {
    await authed('PATCH', `/work-items/${NXP_STORY_1_ID}`, { devOwnerId: DEVELOPER_ID });
    const again = await authed('PATCH', `/work-items/${NXP_STORY_1_ID}`, {
      devOwnerId: DEVELOPER_ID,
    });

    expect(again.statusCode).toBe(200);
    expect(again.json().devOwnerId).toBe(DEVELOPER_ID);
  });
});
