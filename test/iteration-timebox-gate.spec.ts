/**
 * `Plan > Timeboxes` and `Track > Iteration Status` are gated by DIFFERENT codes, and an Editor
 * is refused the first while keeping the second.
 *
 * WHY THIS FILE, GIVEN test/route-policy.ratchet.spec.ts ALREADY EXISTS
 * The ratchet reads SOURCE TEXT and counts undecorated handlers, so it cannot tell a correct
 * `@RequirePermission` from a plausible one — its own docblock says it is "a smoke detector, not
 * an authorization test". This reads the DECORATOR METADATA the guard itself reads (`POLICY_KEY`)
 * and then applies the guard's own decision function (`permissionGrants`) to the catalogue's own
 * Editor and Admin permission sets. A misspelled code, a code moved to the wrong route, or a
 * catalogue edit that quietly re-grants `timebox:view` to the Editor all fail here.
 *
 * WHAT IT STILL CANNOT SEE, and where that is covered
 * It does not exercise `PolicyGuard`, so it cannot catch a `scope` resolving the project from the
 * wrong field — CLAUDE.md records twice that "a spec that calls a service directly cannot see a
 * guard defect". `test/e2e/authz-cluster.e2e.spec.ts` drives the same five routes over real HTTP
 * with a real per-project Editor, which is the assertion that can. This one runs in the unit
 * suite, on every change, with no database.
 *
 * THE DEFECT (RBE-09 / P23-08 / P01-11, audit of 2026-08-14)
 * §3.2 marks `Timeboxes / Iterations` **Hidden** for an Editor and `Create, View, Edit, Delete`
 * for Admin and WA, while the row directly above grants the Editor `Iteration Status | View and
 * update in assigned Teams`. One code — `iteration:view` — gated both, so an Editor read the whole
 * timebox inventory on a screen the BA hides. Revoking it was not available: four surfaces §3.2
 * grants an Editor read `GET /iterations`.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { POLICY_KEY } from '@modules/access';
import { ACCESS_LEVEL_PERMISSIONS, permissionGrants } from '@shared-kernel';
import { IterationsController } from '../libs/modules/iterations/src/interface/http/iterations.controller';

/** The permission a handler's `@RequirePermission` actually declares, read as the guard reads it. */
function requiredPermission(handler: keyof IterationsController): string {
  const meta = Reflect.getMetadata(POLICY_KEY, IterationsController.prototype[handler]) as
    { permission?: string } | undefined;
  expect(meta?.permission, `${String(handler)} declares no @RequirePermission`).toBeTruthy();
  return meta!.permission!;
}

/**
 * The two surfaces, named by the BA row they implement rather than by route, so a reader can check
 * the assertion against §3.2 without opening the controller.
 */
const TIMEBOXES_SURFACE = ['getIteration', 'getActivity'] as const;
const EDITOR_SURFACES = ['listIterations', 'getAssignmentOptions', 'getIterationStatus'] as const;

describe('the Timeboxes surface and Iteration Status are separately gated', () => {
  it('gates the Timeboxes reads on timebox:view', () => {
    for (const handler of TIMEBOXES_SURFACE) {
      expect(requiredPermission(handler), handler).toBe('timebox:view');
    }
  });

  it('leaves the Editor-reachable iteration reads on iteration:view', () => {
    /**
     * The list is included deliberately even though it also feeds the Timeboxes GRID: it is the
     * picker feed for Iteration Status, the Backlog's iteration filter, Team Status and Quality.
     * Moving it to `timebox:view` would 403 all four, which is the failure mode that made
     * "just revoke iteration:view from the Editor" the wrong fix.
     */
    for (const handler of EDITOR_SURFACES) {
      expect(requiredPermission(handler), handler).toBe('iteration:view');
    }
  });

  it('REFUSES an Editor the Timeboxes surface', () => {
    const editor = [...ACCESS_LEVEL_PERMISSIONS.editor];
    for (const handler of TIMEBOXES_SURFACE) {
      expect(permissionGrants(editor, requiredPermission(handler)), handler).toBe(false);
    }
  });

  it('ALLOWS an Editor Iteration Status and every iteration picker', () => {
    // The other direction, and it is not decoration: a fix that hid Timeboxes by revoking
    // `iteration:view` would pass the test above and fail this one.
    const editor = [...ACCESS_LEVEL_PERMISSIONS.editor];
    for (const handler of EDITOR_SURFACES) {
      expect(permissionGrants(editor, requiredPermission(handler)), handler).toBe(true);
    }
  });

  it('ALLOWS a per-project Admin both surfaces', () => {
    // §3.2 gives Admin `Create, View, Edit, Delete` on Timeboxes and `View and update` on
    // Iteration Status, so a split that denied Admin either one would be a different defect.
    const admin = [...ACCESS_LEVEL_PERMISSIONS.admin];
    for (const handler of [...TIMEBOXES_SURFACE, ...EDITOR_SURFACES]) {
      expect(permissionGrants(admin, requiredPermission(handler)), handler).toBe(true);
    }
  });
});
