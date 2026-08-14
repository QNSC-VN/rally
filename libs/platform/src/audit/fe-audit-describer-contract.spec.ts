import { describe, it, expect } from 'vitest';
// Backend authoritative catalogue of audited actions.
import { AUDIT_ACTION } from './audit-event';
// The frontend's presentation registry. The SPA cannot import server code into the browser bundle, so
// it maintains its own map from action code to sentence; this contract test — which runs in the Node
// backend suite, where both are importable — is what stops the two drifting.
import { ACTION_TEMPLATES_FOR_CONTRACT } from '../../../../apps/web/src/entities/audit/model/describe-audit';

/**
 * Every audited action must have a describer.
 *
 * Six codes had none: `workspace.invitation.resent`, `role.created`, `role.deleted` and all three
 * `project.member.*` grants — the last of which `AUDIT_ACTION`'s own comment calls the most sensitive
 * administrative write in the access model. They fell through to the fallback and rendered
 * "Project Member Added — Project 019f742b": no actor, no level, no person granted. §8 requires the
 * Audit Log to report these, and a sentence that names nothing does not.
 *
 * The fallback is deliberately kept (a backend that ships a new action must never render a blank
 * cell), and that is exactly why this test is needed: graceful degradation makes a missing template
 * INVISIBLE. Nothing failed, no cell was empty, and the log simply said less than it should for six
 * of its actions. The same shape as this repo's other unfalsifiable-control bugs — a cited spec that
 * did not exist, a metric name nothing recorded.
 *
 * Mirrors `fe-permission-contract.spec.ts`, including why it lives on this side of the boundary.
 * Deliberately NOT an equality check: the frontend also describes `auth.*` codes written by
 * `@qnsc-vn/identity`, which are not in this repo's `AUDIT_ACTION` at all.
 */
describe('frontend audit describer contract', () => {
  it('every AUDIT_ACTION code has a frontend describer template', () => {
    const missing = Object.entries(AUDIT_ACTION)
      .filter(([, code]) => ACTION_TEMPLATES_FOR_CONTRACT[code] === undefined)
      .map(([name, code]) => `${name} (${code})`);

    expect(
      missing,
      `actions with no describer, so they render through the generic fallback: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('describes the auth actions the identity package writes', () => {
    // These are the highest-VOLUME rows in the log and belong to no `AUDIT_ACTION` entry, so the check
    // above cannot see them. Listed literally, from `AuthService`'s own emits: a rename there must
    // fail here rather than quietly degrade every sign-in row to "Auth Login Sso — Workspace 019f…".
    for (const code of [
      'auth.login.sso',
      'auth.login.dev',
      'auth.logout',
      'auth.switch_workspace',
      'auth.token_theft_detected',
    ]) {
      expect(ACTION_TEMPLATES_FOR_CONTRACT[code], `no describer for ${code}`).toBeDefined();
    }
  });
});
