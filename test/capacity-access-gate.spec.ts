/**
 * Capacity Planning is Workspace Admin / Admin only — an Editor is refused, draft or published.
 *
 * THE RULE, quoted from the BA's own SRS on `product-docs` `origin/main`
 *   • `P5-CAP-AC-010` — "Workspace Admin manages all Projects; Admin manages assigned Projects;
 *     Editor/No Access do not access Capacity Planning. (Viewer level removed.)"
 *   • `P5-CAP-AC-013` — N/A, "Viewer level removed; access model is now 3-level … Capacity Planning is
 *     hidden from Editor and No Access."
 *   • `P5-CAP-AC-012` — Capacity Planning "uses the fixed Phase 4 Project Access baseline and has no
 *     temporary editable Full/View permission row."
 *
 * WHY THIS FILE EXISTS, and what it replaced
 * Two e2e cases used to assert this by building a "read-only planner" from a CUSTOM ROLE holding
 * `project:view` + `capacity:view` (+ `capacity:view_draft`) and checking it could open Drafts. That
 * principal is exactly what AC-010/AC-013 removed, and custom roles are themselves deleted (AC-11), so
 * those tests pinned a shape the SRS had deleted using a mechanism the product no longer offers.
 *
 * Then the obvious replacement — assert `CapacityPlansService.listPlans` REFUSES an Editor — also
 * failed, and for the right reason: the access decision is a ROUTE gate, and `listPlans` deliberately
 * FILTERS (that is how Drafts are hidden), so calling the service directly returns rows. CLAUDE.md
 * records that trap twice: a spec that calls a service directly cannot see a guard defect.
 *
 * So this reads the DECORATOR METADATA the guard itself reads (`POLICY_KEY`) and applies the guard's own
 * decision function (`permissionGrants`) to the catalogue's own Editor and Admin permission sets. It
 * catches a misspelled code, a code moved to the wrong handler, and — the one that matters most here — a
 * catalogue edit that quietly grants an Editor any capacity code.
 *
 * WHAT IT CANNOT SEE
 * It does not exercise `PolicyGuard`, so it cannot catch a `scope` that resolves the project from the
 * wrong field. Mirrors `test/iteration-timebox-gate.spec.ts`, including that limitation; it runs in the
 * unit suite with no database.
 */
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { POLICY_KEY } from '@modules/access';
import { ACCESS_LEVEL_PERMISSIONS, permissionGrants } from '@shared-kernel';
import { CapacityPlansController } from '../libs/modules/capacity/src/interface/http/capacity-plans.controller';

/** The permission a handler's `@RequirePermission` actually declares, read as the guard reads it. */
function requiredPermission(handler: keyof CapacityPlansController): string {
  const meta = Reflect.getMetadata(POLICY_KEY, CapacityPlansController.prototype[handler]) as
    { permission?: string } | undefined;
  expect(meta?.permission, `${String(handler)} declares no @RequirePermission`).toBeTruthy();
  return meta!.permission!;
}

/** Named by what a planner does, so the assertion reads against the AC rather than against routes. */
const READS = ['listPlans', 'getPlan'] as const;
const WRITES = ['createPlan', 'updatePlan'] as const;
// Publish carries its OWN code rather than `capacity:manage`: it writes Release and planned dates onto
// allocated Features (AC-009), i.e. outside the plan, so it is separable from ordinary plan editing. I
// asserted `capacity:manage` here first and this spec caught it.
const PUBLISH = ['publishPlan'] as const;

describe('Capacity Planning is gated to Admin and Workspace Admin (P5-CAP-AC-010/012/013)', () => {
  it('gates every capacity read and write on a capacity code', () => {
    for (const handler of READS) {
      expect(requiredPermission(handler), handler).toBe('capacity:view');
    }
    for (const handler of WRITES) {
      expect(requiredPermission(handler), handler).toBe('capacity:manage');
    }
    for (const handler of PUBLISH) {
      expect(requiredPermission(handler), handler).toBe('capacity:publish');
    }
  });

  it('REFUSES an Editor every capacity surface, read and write', () => {
    // The whole of AC-010's "Editor/No Access do not access Capacity Planning": not a narrower view,
    // not drafts-hidden-but-published-visible — no access at all. Publishing changes nothing about it,
    // which is the half the old draft-visibility test could never express.
    const editor = ACCESS_LEVEL_PERMISSIONS.editor;
    for (const handler of [...READS, ...WRITES, ...PUBLISH]) {
      expect(permissionGrants(editor, requiredPermission(handler)), handler).toBe(false);
    }
  });

  it('ALLOWS an Admin to read and manage', () => {
    // Both directions, because a test that only proves the denial passes just as well when the gate is
    // over-tightened and Capacity Planning is unusable for the level that owns it.
    const admin = ACCESS_LEVEL_PERMISSIONS.admin;
    for (const handler of [...READS, ...WRITES, ...PUBLISH]) {
      expect(permissionGrants(admin, requiredPermission(handler)), handler).toBe(true);
    }
  });

  it('has no principal holding capacity:view_draft without capacity:manage', () => {
    /**
     * `capacity:view_draft` exists as a fourth capacity code so a READ-ONLY planner could open Drafts.
     * AC-012 removed that principal ("no temporary editable Full/View permission row"), so the code can
     * no longer distinguish anyone: every level holding it also holds `capacity:manage`.
     *
     * Asserted rather than deleted, deliberately. Retiring a permission that sits in live role arrays
     * needs a migration, not a catalogue edit, and the BA has been asked to confirm no future read-only
     * planner is intended. If one is ever added, this test fails and points at the decision.
     */
    for (const level of ['admin', 'editor'] as const) {
      const codes = ACCESS_LEVEL_PERMISSIONS[level];
      if (permissionGrants(codes, 'capacity:view_draft')) {
        expect(permissionGrants(codes, 'capacity:manage'), level).toBe(true);
      }
    }
  });
});
