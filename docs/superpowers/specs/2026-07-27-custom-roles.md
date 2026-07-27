# Custom roles — design spec

**Date:** 2026-07-27
**Status:** proposed
**Depends on:** P2 PolicyGuard (merged), P1 role reconciliation (merged)

## Problem

The Roles & Permissions settings page is a read-only capability grid for the 3
code-defined roles (`workspace_admin`, `project_admin`, `project_member`). A
workspace admin has no way to tailor access — the page feels broken ("I'm admin
and can't change anything"). The 3 built-ins are deliberately immutable (single
source of truth in `db/permissions.catalog.ts`, BE↔FE contract specs, JIT
provisioning, opshub parity), so the answer is **not** to make them editable.

## Decision

**Keep the 3 built-ins immutable; add workspace-defined CUSTOM roles.** Industry
model (Jira/GitHub/Notion). The schema already supports it:
`access.system_roles.workspace_id` non-null + `is_system=false` = a workspace's
own role; `unique(workspace_id, slug)`.

Non-goals: editing built-ins; per-project role *assignment* UI (tracked
separately — the `assignProjectRole` API exists but has no frontend; that's the
follow-on that fully realizes PBAC in-product).

## Invariants

1. Built-in roles (`is_system=true` OR `workspace_id IS NULL`) are never mutated
   or deleted — backend already returns `ROLE_IMMUTABLE`.
2. A custom role's permission set MUST be a subset of the catalog codes
   (`PERMISSION` values). Unknown codes rejected.
3. A custom role may not grant `workspace:*` (no minting a super-role); and its
   permissions must be ⊆ the creator's own effective permissions (no privilege
   escalation). Today only `workspace_admin` (holds `roles:edit`) can manage
   roles, so this is a guard-rail for future finer-grained admins.
4. Deleting a role in use is blocked (`ROLE_IN_USE`, 409) — admin must reassign
   holders first. No silent cascade of assignments.
5. Permission codes are the stored/enforced unit. The Full/View/None *capability*
   grouping is a UI concern (the 16-row map in `roles-tab`); the editor emits raw
   codes, the backend validates codes. (May promote the map to shared-kernel
   later so BE can render/validate capability-level too — not required now.)

## Backend (Phase 1)

- `role.repository`: add `create(role)` and `delete(id)`.
- `AccessService`:
  - `createRole(actor, { name, description?, permissions[] })` — validate name,
    dedupe slug per workspace (slugify + suffix), enforce invariants 2–3,
    `workspaceId=actor.workspaceId`, `isSystem=false`; emit `role.created` audit.
  - `deleteRole(actor, roleId)` — block built-in (invariant 1) + in-use
    (invariant 4); emit `role.deleted`.
  - `updateRolePermissions` already exists (blocks built-ins); add invariants 2–3
    + `role.updated` audit.
- `AccessController`: `POST /roles` (`roles:edit`), `DELETE /roles/:id`
  (`roles:edit`); reuse existing `PATCH /roles/:roleId/permissions`.
- Specs: extend `access.service.spec` (create/delete/subset-validation/in-use).

## Frontend (Phase 2)

- `roles-tab`: built-in columns keep read-only + a 🔒 "Built-in" badge;
  add `+ Create role`; custom-role columns become editable 3-state
  (Full/View/None) cells + a delete affordance. Editor starts by cloning a
  built-in as a template.
- Custom roles automatically appear in `members-tab`'s picker (it lists all
  workspace roles via `useSystemRoles`).
- Regenerate the OpenAPI client after the backend lands.

## Out of scope / follow-on

- Project-scoped role assignment UI (the `assignProjectRole` frontend) — separate
  spec; that is the piece that makes "admin of Project A, member of Project B"
  reachable in-product.
- Promoting the capability↔code map into shared-kernel for BE-side rendering.
