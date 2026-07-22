# ADR-001 — The Entity Surface Pattern (List / Detail / Form)

**Status:** Accepted · **Date:** 2026-07-22 · **Owner:** Solution Architecture
**Scope:** Every entity that has a table, a detail view, and create/edit forms
(Milestones, Releases, Iterations/Timeboxes, Iteration Status, Backlog, Quality,
Projects, Defects, Work Items, …).

> Read alongside `FRONTEND_CONVENTIONS.md` (the rules) and
> `FRONTEND_COMPONENT_AUDIT.md` (the full component-level audit). This ADR is
> narrower: it defines the **one pattern** every entity screen must follow so
> Milestones, Releases and Timeboxes stop diverging from Iteration Status.

---

## 1. Context

An audit of Milestones, Releases, Iterations (the `/timeboxes` route), and
Iteration Status found that the **grid shell is already unified** — all four use
`DataTableFrame` + `useDataTable` + a `ColumnSpec[]`. That layer is mature and
documented and must not be rebuilt.

The inconsistency the audit was chasing is **not** in the list tables. It is in
everything *around* the grid engine, and it comes from there being no agreed
contract for the two layers that sit next to it: the **detail surface** and the
**form**. As a result each entity re-invented them:

| Concern | Iteration Status | Milestones | Releases | Iterations (Timeboxes) |
|---|---|---|---|---|
| Grid shell | `DataTableFrame` | `DataTableFrame` | `DataTableFrame` | `DataTableFrame` |
| Body rows | `StatusRow` component | `table.renderCells` | `ReleaseRow` component | **inline JSX in page** |
| List sort | local `useState` | `useTableSort` | `useTableSort` | local `useState` |
| Detail | shared `/item` route | routed page, `DetailHeader` + **hand-rolled tabs** | routed page, `DetailHeader` + **hand-rolled tabs** (+ **orphan modal**) | **in-place, hand-rolled header** |
| Linked-items sub-table | n/a | shared `ArtifactTable` (dup wrapper) | shared `ArtifactTable` (dup wrapper) | **hand-rolled `<table>`** |
| Create/edit form | bespoke modal | bespoke modals | bespoke modal (+ dead detail-modal) | bespoke modals |

Concrete debt found:
- **4 different row-rendering strategies** for one concept.
- `pages/iterations/ui/iteration-parts.tsx` hand-rolls its own dark detail
  header **and** a raw `<table>` for linked items, instead of `DetailHeader` +
  `ArtifactTable`.
- `pages/releases/ui/release-detail-modal.tsx` is an **orphaned** edit modal
  (rendered on `editingRelease`, which is never set) duplicating the detail page.
- The `ArtifactsTab` toolbar + pagination is **copied verbatim** between
  Milestones and Releases and re-implements the shared `PaginationFooter`.
- Tab bars are hand-rolled `<button>`s everywhere despite a shared `Tabs`.
- Sort is `useTableSort` on some pages, local `useState` on others.

Root cause: **only the list layer had a defined contract.** Detail and form did
not, so "consistent" was left to reviewer memory.

---

## 2. Decision

**1. Every entity screen is composed of three layers, each config-driven from a
per-entity catalog, each assembled from shared primitives.** This is the same
"engine + shell + config" shape already proven on tables, extended to detail and
form.

**2. The detail surface is a routed page** (`/<entity>/$id`), never a modal.
(Decision: routed pages deep-link, support tabs and rich sub-tables, and match
the existing `DetailHeader` design. The orphaned `ReleaseDetailModal` is deleted,
not revived.) Modals are for **create and quick-edit only**.

**3. One entity = one of each:** one column catalog, one field catalog, one
detail route, one create/edit modal, one data-fetching hook module.

---

## 3. The pattern

### Layer contract

```
LIST                         DETAIL                        FORM
────                         ──────                        ────
DataTableFrame   (shell)     DetailLayout   (shell)  ◀BUILD AppModal        (shell)
useDataTable     (engine)    (routed page)                 FieldSpec-driven  (engine) ◀BUILD
ColumnSpec[]     (config)    FieldSpec[]    (config) ◀BUILD (shared entity form)
                             DetailTabBar           ◀BUILD
```

- **Shell** — owns chrome (scroll, header, tabs, footer, loading/error/empty).
  Shared, page-agnostic, cannot drift.
- **Engine** — headless; turns a config catalog into behaviour + ready-to-spread
  props.
- **Config catalog** — the per-entity source of truth. Adding a field is a
  one-line change to an array. Lives in `entities/<x>/model`, not in the page.

### Per-entity file layout (Feature-Sliced Design)

```
entities/<entity>/model/
  columns.ts        # ColumnSpec[]  — the list grid
  fields.ts         # FieldSpec[]   — the detail + form fields (NEW)
features/<entity>/
  api.ts            # TanStack Query hooks (already the norm)
pages/<entity>/
  <entity>-page.tsx         # list: assembles DataTableFrame from columns.ts
  <entity>-detail-page.tsx  # detail: assembles DetailLayout from fields.ts
  ui/<entity>-row.tsx       # ONE row component (no inline JSX, no renderCells drift)
  ui/create-<entity>-modal.tsx  # AppModal + shared entity form from fields.ts
```

### List rules (mostly already met)

- Grid = `DataTableFrame` + `useDataTable(columns, …)`. No raw `<table>` in `pages/**`.
- Body rows = **one named row component per entity** (e.g. `ReleaseRow`). No
  inline JSX row maps (fixes Iterations), no split between `renderCells` and
  hand-rolled cells within the same app for the same concept — pick the row
  component form as the standard since editable grids need it.
- Sort = the shared `useTableSort` hook everywhere. Delete local `useState` sort.
- Sub-tables of linked work items = `entities/work-item/ui/artifact-table.tsx`.
  The search-toolbar + `PaginationFooter` wrapper around it is **one shared
  component** (`ArtifactsTab`), not copied per entity.

### Detail rules

- Routed page at `/<entity>/$id`.
- Chrome = **`DetailLayout`** (to build) = `DetailHeader` + `DetailTabBar` +
  scroll body + optional side-panel slot. No page hand-rolls the dark header
  (fixes Iterations) or its own tab `<button>`s (fixes all three).
- Tabs = `DetailTabBar` built on the existing shared `Tabs`.
- Fields = rendered from the entity's `FieldSpec[]` via a shared field grid, so
  detail (read) and form (edit) render the same field definitions.

### Form rules

- Create / quick-edit = `AppModal` + `ModalBody` + `ModalFooter`.
- Fields rendered from the same `FieldSpec[]` the detail page uses (one source of
  truth for label / control / validation), via `FormField` + shared inputs.
- **Standardize form state.** `react-hook-form` is already in the tree but used
  only in Settings; adopt it for all entity create/edit forms and drop the ad-hoc
  `useState` bags. (If the team prefers not to, that is a separate ADR — but pick
  one and enforce it.)
- Data = TanStack Query hooks in `features/<x>/api.ts`. No new patterns; no RTK Query.

---

## 4. Primitives to build

Priority order (each unblocks a set of migrations):

1. **`shared/ui/detail/detail-layout.tsx`** — the detail equivalent of
   `DataTableFrame`: header + tab bar + scroll body + side-panel slot.
2. **`shared/ui/detail/detail-tab-bar.tsx`** — the `DetailTabBar` the
   `DetailHeader` doc comment already promises, on top of shared `Tabs`.
3. **`entities/*/model/fields.ts` + a `FieldSpec<Entity>` type** in
   `shared/ui/detail/types.ts` — mirrors `ColumnSpec`: `{ key, label, control,
   render, editable, section }`. Drives both the detail field grid and the form.
4. **`shared/ui/detail/field-grid.tsx` + `detail-section.tsx`** — declarative
   field/section rendering from `FieldSpec[]`.
5. **`ArtifactsTab`** promoted to a shared component (toolbar + `ArtifactTable` +
   `PaginationFooter`), replacing the two verbatim copies.

Nothing else in `shared/ui` needs to be built for this pattern — everything else
(`DetailHeader`, `AppModal`, `ConfirmDialog`, `FormField`, `StatusBadge`,
`MetricStrip`, `ArtifactTable`, `Tabs`) already exists and is correct.

---

## 5. Remediation (mapped to the concrete debt)

Non-blocking; do it entity-by-entity behind the new primitives.

- **Phase 0 — Foundation ✅ DONE:** built the shared detail primitives —
  `shared/ui/detail/{detail-layout,detail-tab-bar,detail-field}.tsx` (+ barrel)
  and the shared linked-artifacts tab
  `entities/work-item/ui/{artifacts-tab.tsx,use-artifact-pagination.ts}`.
  (`FieldSpec`-driven fields deferred to a later phase — see below.)
- **Phase 1 — Reference entity (Releases) ✅ DONE:** `releases-detail-page.tsx`
  now assembles `DetailLayout` + `DetailTwoPane` + `DetailField*`; the Artifacts
  tab delegates to the shared `ArtifactsTabView` (now on the shared
  `PaginationFooter`); **orphan `release-detail-modal.tsx` deleted** with its
  `editingRelease` wiring. This is the copy-me exemplar.
- **Phase 2 — Milestones ✅ DONE:** `milestones-detail-page.tsx` migrated onto
  the same primitives; sidebar widths/backgrounds now identical to Releases
  (`w-80` + `bg-card`). Duplicate `ArtifactsTab` collapsed to the shared view.
  _(Remaining: move inline `MILESTONES_COLUMNS` to `entities/milestones/model`.)_
- **Phase 3 — Iterations/Timeboxes (worst offender) — TODO:** replace inline-JSX
  rows with an `IterationRow` component; replace the hand-rolled detail header
  with `DetailLayout`; replace the raw `<table>` `IterationScope` with the shared
  `ArtifactsTabView`; switch local sort to `useTableSort`; promote in-place
  detail to a `/iterations/$id` route.
- **Phase 4 — `FieldSpec` catalogs — TODO:** once ≥3 entities share
  `DetailField`, extract per-entity `fields.ts` so detail + create/edit forms
  render from one declaration (the table layer's `ColumnSpec` equivalent).

> Verification of Phases 0–2: `tsc -b` (build), `eslint`, and `vite build` all
> green. NOTE: `npm run typecheck`'s first command (`tsc --noEmit` on the root
> solution `tsconfig.json`, which has `"files": []`) checks nothing — the real
> app typecheck is `tsc -b` / `tsc --noEmit -p tsconfig.app.json`. Fixing that
> no-op is worth a follow-up. (Two pre-existing `TS2352` sort-cast errors in the
> list pages, unrelated to this refactor, were fixed via `as unknown as` to
> unblock the build.)

---

## 6. Governance — so it cannot re-drift

The pattern only holds if regressions are mechanically impossible, not just
discouraged:

- **ESLint `no-restricted-syntax`:** ban `<table>` in `pages/**` and
  `entities/**` (allow only inside `shared/ui/**` and `artifact-table.tsx`).
- **ESLint boundary rule:** `ColumnSpec` / `FieldSpec` catalogs must live in
  `entities/*/model/**`, not in `pages/**`.
- **PR checklist (add to template):** new entity screen? → uses `DataTableFrame`,
  a named row component, `useTableSort`, `DetailLayout`, `DetailTabBar`, a
  `FieldSpec[]`, `AppModal` for create — or an ADR exception is linked.
- **Definition of Done per entity:** one column catalog, one field catalog, one
  detail route, one create/edit modal, zero raw `<table>`, zero hand-rolled
  header/tab bars.

---

## 7. Consequences

- **+** Consistency becomes structural, not vigilance-based; adding an entity is
  "fill in two catalogs + assemble three shells."
- **+** A field/column is added in one line, in one place.
- **−** Up-front cost of 5 primitives + 3 migrations (bounded, non-blocking).
- **−** `FieldSpec` must be expressive enough for the odd bespoke panel
  (burndown, capacity). Escape hatch: a `render` slot on `FieldSpec` and a raw
  child slot on `DetailLayout`'s side panel — bespoke stays possible, just not
  the default.
