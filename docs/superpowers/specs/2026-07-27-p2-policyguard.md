# P2 — Single PolicyGuard (full consolidation)

**Author:** Nghia-VanTrong (SA lead) · **Date:** 2026-07-27 · Follows the RBAC reconciliation (#183).

## Goal
Collapse the **three** enforcement mechanisms into **one** guard + one decorator:
- `PermissionGuard` (`@RequirePermission`, workspace-tier, JWT baseline)
- `ProjectPermissionGuard` (`@RequireProjectPermission`, project-tier, id-in-request)
- service-level `AccessService.assertProjectPermission` (project-tier, id-after-load)

## Target API
One decorator, tier-safe by overload:

```ts
@RequirePermission('workspace:edit')                              // workspace-tier
@RequirePermission('iteration:view', { from: 'query', field: 'projectId' })  // project id in request
@RequirePermission('release:edit',  { resource: 'release', from: 'param', field: 'id' }) // guard loads → projectId
```

`scope`:
- **absent** ⇒ workspace-tier (checked against JWT baseline via `permissionGrants`).
- **`{ from, field }`** ⇒ project id read directly from the request bag.
- **`{ resource, from, field }`** ⇒ guard resolves the resource by id → its `projectId` (a real load; the "full" choice).

## Components
1. **`ProjectScopeResolver`** (new, access module) — `resolve(resource, id, workspaceId): Promise<string>`. One service with a per-resource Drizzle lookup of the `project_id` column (release, milestone, work_item, iteration, task, …). Throws `*_NOT_FOUND` if absent (so a missing row is a clean 404, not a 403).
2. **`PolicyGuard`** (new, replaces both guards) —
   - workspace-tier: `permissionGrants(user.permissions, code)`.
   - project-tier: fast-path wildcard → else resolve projectId (request or resolver) → `getProjectPermissions` union → `permissionGrants`. Deny ⇒ `PROJECT_PERMISSION_DENIED`. Fail-closed on missing user.
3. **Unified `@RequirePermission`** + `@AuthPolicy()` class decorator bundling `JwtAuthGuard → PolicyGuard` in one `@UseGuards` (guaranteed order).
4. Keep the compile-time tier split (`WorkspacePermission` / `ProjectPermission`); overload the decorator so a project code REQUIRES a scope and a workspace code FORBIDS one.

## Trade-off (accepted)
Post-load endpoints now load twice: once in the guard (to get `projectId`) and once in the service (to act). Cost is one extra indexed PK lookup per such request; benefit is one uniform, greppable, testable enforcement point and no "did I remember the service assert?" gap.

## Rollout (additive, per-module, full-suite verified each step)
1. Build `ProjectScopeResolver` + `PolicyGuard` + unified decorator **alongside** the existing ones (nothing removed yet).
2. Migrate module-by-module: swap decorators, delete that module's service-level `assertProjectPermission` calls + its `getXForView` view-asserts where the guard now covers them. Order: releases → milestones → iterations → work-items → team-status → quality → scm → projects/workflow → reporting → collaboration → access/workspace/team (workspace-tier, simplest).
3. When every controller is migrated, delete `ProjectPermissionGuard`, `@RequireProjectPermission`, `@AuthProjectScoped`, and the old `PermissionGuard` wiring (or keep `PermissionGuard` internals if `PolicyGuard` subsumes it).
4. Re-run **full unit + e2e** after each module.

## Non-goals (separate)
Converging onto opshub's shared guard package (lockstep) — do after this lands in-repo. RLS. `ensureDefaultRole` policy.
