# RBAC Permission Catalog & Enforcement Contract (Enterprise, long-term)

**Author:** Nghia-VanTrong (SA lead) · **Date:** 2026-07-26 · **Status:** Proposal
**Companion:** `2026-07-26-rbac-pbac-architecture.md` (model rationale)

The authoritative source of truth: **boolean permission grants**, `resource:action`,
assigned to roles at a **scope**. No E/R/D/H stored (UI presentation is derived
client-side). Every endpoint maps to exactly one code + a scope source.

---

## 1. Principles

1. **Deny by default, fail closed.** No grant ⇒ denied; resolution error ⇒ denied.
2. **Boolean grants only.** A permission is held or not. `read-only` = holds `:view`, lacks `:edit` (derived). Show/hide/disable is a **frontend** decision, never stored.
3. **`resource:action`, plural resources, one code per action.** No `*` wildcard as a gate, no generic `:manage` that fuses create+edit+delete.
4. **Scope dimensions:** `global | workspace | project | team`. A grant is `(role, code)` held at a scope instance.
5. **Roles = named code bundles.** Canonical roles (WA/PA/PM) are immutable. Custom roles (future) editable; canonical locked as the recovery anchor.
6. **One guard resolves + decides** (`@RequirePermission(code, scopeFrom?)`); resolve-and-cache per request; presentation derived in the FE.
7. **Enforcement is per-endpoint + per-flow**, never "trust the UI." The tables below are the contract; a contract test asserts every mutating route names a code.

## 2. Scope model

| Scope | Meaning | Resolved from |
|---|---|---|
| `global` | platform-wide (system roles) | — |
| `workspace` | the whole company/tenant | `user.workspaceId` (token) |
| `project` | one project | request `projectId` (param/query/body) or the loaded row's `projectId` |
| `team` | one team within a project | request `teamId` / loaded row |

- **WA** holds workspace-scope grants → apply everywhere in the company.
- **PA** holds project-scope grants on **assigned** projects (mutations), plus a workspace-scope `projects:view` (see all, read-only in non-assigned).
- **PM** holds project-scope grants on the **assigned** project only.
- **Non-admin access is gated by project membership first**, team second. No grant on Project Y ⇒ cannot read Y (fixes today's cross-project read leak).

## 3. Permission catalog (the codes)

Tier = the scope a code is normally granted/checked at.

### Company / workspace (tier: workspace)
| Code | Guards |
|---|---|
| `workspace:view` | view company settings |
| `workspace:edit` | edit company settings (name, tz/locale defaults) |
| `workspace:delete` | delete the workspace |
| `users:view` | view user roster |
| `users:invite` | invite a user |
| `users:activate` / `users:deactivate` | (de)activate a user |
| `users:remove` | remove a user |
| `users:assign_role` | assign/revoke roles (any scope) |
| `roles:view` | view the Roles & Permissions capability viewer |
| `roles:edit` | edit custom roles (canonical locked) |
| `teams:view` | view teams |
| `teams:create` / `teams:edit` / `teams:archive` | team lifecycle |
| `teams:manage_members` | add/remove team members, allocate capacity |
| `audit:view` | view the audit log |
| `portfolio:view` *(Phase 5)* | portfolio hierarchy |

### Projects (tier: workspace for list/create; project for the rest)
| Code | Tier | Guards |
|---|---|---|
| `projects:view` | workspace | see the Manage Projects list / open a project |
| `projects:create` | workspace | create a project |
| `projects:edit` | project | edit project settings |
| `projects:archive` / `projects:restore` | project | archive / restore |
| `projects:delete` | project | delete |
| `projects:manage_members` | project | add/update/remove project members |
| `workflow:view` / `workflow:edit` | project | workflow statuses + transitions *(edit deferred)* |
| `labels:view` / `labels:edit` | project | labels *(edit deferred)* |

### Delivery — work items, tasks, collaboration (tier: project)
| Code | Guards |
|---|---|
| `work_items:view` | read US/DE/Feature/Initiative |
| `work_items:create` | create |
| `work_items:edit` | edit fields/desc/notes/mentions/relations/watchers/state |
| `work_items:delete` | delete |
| `work_items:rank` | rank / move within backlog |
| `tasks:view/create/edit/delete` | child tasks |
| `comments:view/create/edit/delete` | comments (own-vs-any enforced in service) |
| `attachments:view/manage` | attachments |

### Planning — iterations, releases, milestones (tier: project)
| Code | Guards |
|---|---|
| `iterations:view` | Timeboxes management screen |
| `iterations:create/edit/delete` | iteration lifecycle |
| `iterations:commit/accept/rollover` | state transitions |
| `iterations:assign` | assign a work item to an iteration |
| `iteration_status:view` | Iteration Status screen |
| `iteration_status:edit` | create/edit/delete US-DE from Iteration Status |
| `releases:view` | releases list/detail |
| `releases:create/edit/delete` | release lifecycle |
| `releases:assign` | assign a work item to a release |
| `milestones:view` | milestones list/detail |
| `milestones:create/edit/delete` | milestone lifecycle |
| `milestones:link` | link projects/teams/releases/artifacts |

### Team status · quality · SCM · reports (tier: project; scm:manage = workspace)
| Code | Tier | Guards |
|---|---|---|
| `team_status:view` / `team_status:edit` | project | capacity + task edits |
| `quality:view` | project | Quality/Defect dashboard |
| `scm:view` | project | SCM connections/changesets on a work item |
| `scm:manage` | workspace | SCM installations + repositories |
| `reports:view` *(Phase 5)* | project | reports |

### System rows (tier: self; locked, granted to everyone)
| Code | Guards |
|---|---|
| `auth:session` | login/logout/session |
| `app_shell:view` | shell + nav |
| `profile:view` / `profile:edit` | own profile/preferences |
| `notifications:view` / `notifications:read` / `notifications:manage_prefs` | own notifications |

## 4. Role → permission matrix (boolean)

`✓` = granted · `—` = not granted · `P` = granted at **project** scope (assigned projects only) · `W` = workspace scope · 🔒 system (all roles).

### System (🔒 all)
`auth:session`, `app_shell:view`, `profile:*`, `notifications:*` → ✓ WA ✓ PA ✓ PM.

### Company / workspace
| Code | WA | PA | PM |
|---|---|---|---|
| workspace:view / edit / delete | W✓ | — | — |
| users:view | W✓ | — | — |
| users:invite / activate / deactivate / remove / assign_role | W✓ | — | — |
| roles:view / edit | W✓ | — | — |
| teams:view | W✓ | P (read) | P (read) |
| teams:create / edit / archive / manage_members | W✓ | — | — |
| audit:view | W✓ | — | — |
| portfolio:view *(P5)* | W✓ | P | — |

### Projects
| Code | WA | PA | PM |
|---|---|---|---|
| projects:view | W✓ | W✓ (all, read-only detail off-assignment) | — (direct to assigned project) |
| projects:create | W✓ | — | — |
| projects:edit | W✓ | P | — |
| projects:archive / restore / delete | W✓ | — | — |
| projects:manage_members | W✓ | — | — |
| workflow:view / labels:view | W✓ | P | — |
| workflow:edit / labels:edit | W✓ | *(deferred)* | — |

### Delivery (work items / tasks / collaboration)
| Code | WA | PA | PM |
|---|---|---|---|
| work_items:view / create / edit / delete / rank | W✓ | P | **P** |
| tasks:view / create / edit / delete | W✓ | P | **P** |
| comments:view / create / edit / delete | W✓ | P | **P** |
| attachments:view / manage | W✓ | P | **P** |

### Planning
| Code | WA | PA | PM |
|---|---|---|---|
| iterations:view / create / edit / delete / commit / accept / rollover | W✓ | P | **—** |
| iterations:assign | W✓ | P | **P** |
| iteration_status:view / edit | W✓ | P | **P** |
| releases:view / create / edit / delete / assign | W✓ | P | **—** |
| milestones:view / create / edit / delete / link | W✓ | P | **—** |

### Team status · quality · SCM · reports
| Code | WA | PA | PM |
|---|---|---|---|
| team_status:view / edit | W✓ | P | — |
| quality:view | W✓ | P | — |
| scm:view | W✓ | P | P |
| scm:manage | W✓ | — | — |
| reports:view *(P5)* | W✓ | P | — |

## 5. Endpoint → permission contract

`scope`: how the guard resolves the project/workspace instance. `svc` = enforced in service after load. Rows marked **⚠fix** are today's gaps this contract closes.

### Company / workspace — `workspace.controller.ts`, `access.controller.ts`, `audit.controller.ts`
| Method + route | Code | Scope |
|---|---|---|
| GET /workspaces | `workspace:view` | workspace |
| GET /workspaces/:id | `workspace:view` | workspace |
| POST /workspaces | `workspace:create`†| global |
| PATCH /workspaces/:id | `workspace:edit` ⚠fix (was `workspace:*`) | workspace |
| DELETE /workspaces/:id | `workspace:delete` ⚠fix | workspace |
| GET/PATCH /workspaces/:id/settings | `workspace:view` / `workspace:edit` ⚠fix | workspace |
| GET :id/members, members-with-profile | `users:view` | workspace |
| POST/PATCH/DELETE :id/members* | `users:assign_role` / `users:remove` | workspace |
| POST :id/invitations | `users:invite` | workspace |
| GET :id/invitations | `users:view` | workspace |
| DELETE :id/invitations/:iid | `users:invite` | workspace |
| POST /invitations/accept | `auth:session` (self) | self |
| GET /roles | `roles:view` | workspace |
| GET /permissions | `roles:view` ⚠fix (was manage_members) | workspace |
| PATCH /roles/:id/permissions | `roles:edit` ⚠fix | workspace |
| GET /users/:uid/role-assignments | `users:view` | workspace |
| POST/DELETE /role-assignments* | `users:assign_role` | workspace |
| GET /projects/:pid/my-permissions | self | self |
| POST/DELETE /projects/:pid/role-assignments | `projects:manage_members` | project=pid |
| GET /audit-logs | `audit:view` ⚠fix (was `workspace:*`) | workspace |

### Teams — `team.controller.ts`
| GET workspaces/:wid/teams, teams/:id, teams/:id/members | `teams:view` | workspace |
| POST/PATCH teams* | `teams:create`/`teams:edit` ⚠fix (was manage_teams) | workspace |
| POST/DELETE teams/:id/members* | `teams:manage_members` | workspace |

### Projects — `projects.controller.ts`, `workflow.controller.ts`
| GET /projects, /projects/health | `projects:view` | workspace |
| POST /projects | `projects:create` | workspace |
| GET /projects/:id (+ statuses/transitions/labels/teams/members reads) | `projects:view` | project=id |
| GET /projects/:id/activity | `projects:view` | project=id |
| PATCH /projects/:id | `projects:edit` | project=id |
| POST :id/archive / restore | `projects:archive` / `projects:restore` | project=id |
| DELETE /projects/:id | `projects:delete` | project=id |
| POST/PATCH/DELETE :id/labels* | `labels:edit` | project=id |
| POST :id/teams, DELETE :id/teams/:tid | `projects:edit` | project=id |
| POST/PATCH/DELETE :id/members* | `projects:manage_members` | project=id |
| POST/PATCH/DELETE projects/:pid/statuses*, transitions* | `workflow:edit` | project=pid |

### Work items / tasks / collaboration — `work-items.controller.ts`, `collaboration.controller.ts`
| GET /work-items, /backlog | `work_items:view` | project=query.projectId |
| GET /work-items/my, /summary | self aggregate | self |
| GET /work-items/by-key | `work_items:view` ⚠fix (was `workspace:view`) | project=loaded (svc) |
| GET /:id (+ tasks/relations/labels/milestones/time-logs/watchers/attachments reads) | `work_items:view` | project=loaded (svc) |
| POST /work-items | `work_items:create` | project=body.projectId (svc) |
| PATCH /:id, bulk-* , reorder | `work_items:edit` | project=loaded (svc) |
| DELETE /:id | `work_items:delete` | project=loaded (svc) |
| POST/PATCH/DELETE :id/tasks* | `tasks:*` ⚠fix (add explicit codes) | project=loaded (svc) |
| POST :id/{labels,relations,milestones,watchers,attachments} | `work_items:edit` | project=loaded (svc) |
| POST :id/rank, :id/move | `work_items:rank` | project=loaded (svc) |
| GET/POST/PATCH/DELETE work-items/:id/comments* | `comments:*` | project=loaded (svc) |

### Planning — `iterations.controller.ts`, `releases.controller.ts`, `milestones.controller.ts`
| GET /iterations, /iterations/options | `iterations:view` | project=query.projectId |
| POST /iterations | `iterations:create` | project=body.projectId |
| GET /iterations/:id, /:id/activity | `iterations:view` | project=loaded (svc) |
| PATCH/DELETE /:id | `iterations:edit`/`delete` | project=loaded (svc) |
| POST /:id/commit / accept / rollover | `iterations:commit`/`accept`/`rollover` | project=loaded (svc) |
| GET /:id/status | `iteration_status:view` | project=loaded (svc) |
| POST /:id/work-items | `iteration_status:edit` | project=loaded (svc) |
| (assign WI→iteration, via work-item PATCH) | `iterations:assign` | project=loaded (svc) |
| GET /releases | `releases:view` | project=query.projectId ⚠fix (add code) |
| POST /releases | `releases:create` | project=body.projectId |
| GET /releases/:id, /:id/activity, /:id/burndown, /:id/artifacts | `releases:view` ⚠fix (were authn-only) | project=loaded (svc) |
| PATCH/DELETE /releases/:id | `releases:edit`/`delete` | project=loaded (svc) |
| (assign WI→release) | `releases:assign` | project=loaded (svc) |
| GET /milestones | `milestones:view` | project=query.projectId ⚠fix |
| POST /milestones | `milestones:create` | project=body.projectId |
| GET /milestones/:id (+ activity/artifacts/projects/teams/releases) | `milestones:view` ⚠fix (were authn-only) | project=loaded (svc) |
| PATCH/DELETE /milestones/:id, PUT :id/{artifacts,projects,teams,releases} | `milestones:edit`/`delete`/`link` | project=loaded (svc) |

### Team status · quality · scm · reports
| GET /team-status | `team_status:view` | project=query.projectId |
| PATCH /team-status/capacity | `team_status:edit` | project=body.projectId |
| PATCH /team-status/tasks/:tid | `team_status:edit` | project=loaded (svc) |
| GET /quality/defects | `quality:view` | project=query.projectId |
| GET work-items/:id/connections, /changesets | `scm:view` ⚠fix (was `workspace:view`) | project=loaded (svc) |
| GET /scm/installations, /repositories | `scm:manage` ⚠fix (was manage_members) | workspace |
| POST/DELETE /scm/installations*, /repositories* | `scm:manage` | workspace |
| POST /scm/webhook/:provider | public (HMAC-verified) | — |
| GET /reports/* | `reports:view` ⚠fix (were authn-only) | project=loaded (svc) |

### System — self-scoped, locked
| PATCH /auth/me, GET /bff/me, /bff/switch-workspace, /bff/logout | `profile:*` / `auth:session` (self) | self |
| GET/POST notifications* | `notifications:*` (self) | self |

† `workspace:create` only relevant if multi-workspace self-serve is enabled; single-tenant MVP: WA/system only.

## 6. Key business flows → permissions

| Flow | Permissions (in order) |
|---|---|
| Onboard a user | `users:invite` → (accept = self) → `users:assign_role` (WA) |
| Stand up a project | `projects:create` (WA) → `projects:manage_members` (WA) → `projects:edit` (WA/PA) |
| Assign a Project Admin to run a project | `users:assign_role` (WA) grants PA role at `project` scope |
| Plan work | `work_items:create` → `work_items:edit`/`rank` → `iterations:assign` |
| Run a sprint | `iterations:create` → `iterations:commit` → (`iteration_status:edit`) → `iterations:accept` / `iterations:rollover` |
| Ship a release | `releases:create` → `releases:assign` → `releases:edit` (state) |
| Track quality | `work_items:create` (DE) + `quality:view` (dashboard) |
| Governance | `roles:view` (viewer), `audit:view`, `users:*` — WA only |

## 7. What we deliberately do NOT build
- No stored E/R/D/H; presentation derived FE-side (hide by default, disable rarely).
- No user-editable canonical-role permissions (foot-gun); a **read-only capability viewer** renders §4.
- No ReBAC engine / OPA — `resource:action` + scope covers the product; revisit only for user-driven arbitrary sharing or multi-service policy reuse.
