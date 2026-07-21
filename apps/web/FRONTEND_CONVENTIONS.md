# Rally Web — Frontend Conventions

The rules that keep the UI consistent as the app scales. Enforced by lint + the
ratchet tests in `src/test/fe-consistency.ratchet.test.ts`. Companion to
`FRONTEND_COMPONENT_AUDIT.md` (the why) — this file is the how.

> **Golden rule:** one component owns each pattern. **Pages compose; they never
> re-derive.** If you're about to hand-roll a button, tab bar, modal, grid
> header, status pill, or section card — stop, it already exists in `shared/ui`.

---

## 1. Architecture (Feature-Sliced Design)

Layers, highest → lowest. Import only **downward** (enforced by
`eslint-plugin-boundaries`):

```
app · pages · widgets · features · entities · shared
```

- **Pages are composition only.** No page-level component, modal, schema, or
  domain helper defined inside a `*-page.tsx`. Extract to `pages/<x>/ui/` and
  `pages/<x>/model/`.
- **No sideways slice imports.** A `features/a` slice must not import from
  `features/b`. Shared cross-feature data (members, teams) belongs in `entities`
  or `shared`, consumed through a slice's public `index.ts`.
- Every slice exposes a public API via `index.ts`; import the barrel, not deep paths.

## 2. File size

- Soft budget **300 lines**, hard cap **500**. The ratchet forbids any file
  growing past today's worst (2964) and that ceiling only comes down.
- One component per file. A file that defines 3+ components is a folder waiting
  to happen.

## 3. Components — use the shared primitive

| Need             | Use                                                                  | Never                                                       |
| ---------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Any button       | `Button` (`shared/ui/button`)                                        | raw `<button>`                                              |
| Icon-only action | `IconButton` (`shared/ui/icon-button`)                               | raw `<button>` + inline icon                                |
| Tabs             | `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (`shared/ui/tabs`)     | hand-rolled active-underline `<button>`s                    |
| Modal            | `AppModal` + `ModalBody`/`ModalFooter`                               | `fixed inset-0` divs, `dialog.tsx`                          |
| Confirm delete   | `ConfirmDialog`                                                      | `window.confirm()`, inline confirm buttons                  |
| Multi-select     | `SelectionModal`                                                     | bespoke list + checkboxes                                   |
| Section / panel  | `Card` + `CardHeader`/`CardBody`                                     | `rounded bg-white border` blocks                            |
| Data grid        | `DataTableFrame` + one `ColumnSpec[]`                                | raw `<table>`, bespoke flex-grids, direct `DataTableHeader` |
| Status pill      | `StatusBadge` (+ a feature `status-colors` map)                      | inline `<span>` pills                                       |
| Row of KPIs      | `MetricStrip` + `MetricCard`                                         | hand-rolled metric tiles                                    |
| Empty / error    | `EmptyState`                                                         | centered `<div>` + text                                     |
| Loading          | `Spinner`/`PageSpinner`/`InlineSpinner`                              | inline `<Loader2 className="animate-spin"/>`                |
| Page header      | `PageHeader` / `PageToolbar`                                         | hand-rolled header bars                                     |
| Pagination       | `PaginationFooter` (+ `useClientPagination` / `useCursorPagination`) | bespoke prev/next footers                                   |
| Select / date    | `NativeSelect`/`InlineSelect`                                        | raw `<select>` / `<input type=date>`                        |
| Toast            | `notify` (`shared/lib/toast`)                                        | `import { toast } from 'sonner'` in a page                  |

## 4. Styling & tokens

- **Colour comes from tokens**, never raw hex/rgb (`no-raw-hex.ratchet` = 0).
  Prefer a Tailwind token utility (`text-foreground-subtle`, `bg-surface-hover`,
  `border-border-strong`); use `BRAND.*` inline only when the value is
  computed/data-driven (a status swatch, a `width:${pct}%`, SVG paint).
- **No static-colour inline `style={{}}`.** `style={{ color: BRAND.textMuted }}`
  → `className="text-muted-foreground"`. Inline style is for dynamic values only.
- **Type size comes from the scale.** Use `text-ui-2xs … text-ui-xl` (9–14px,
  defined in `globals.css @theme`), never arbitrary `text-[11px]`.
  - 9px `text-ui-2xs` · 10px `text-ui-xs` · 11px `text-ui-sm` · 12px `text-ui-md`
    · 13px `text-ui-lg` · 14px `text-ui-xl`
- **Dark mode is automatic** via CSS-var flipping — never write `dark:` variants,
  and never hardcode `bg-white`/`text-white` (use `bg-card`/`bg-input-background`).
- Compose classes with `cn()` from `shared/lib/utils`.

## 5. Shared logic — reuse the hook

| Need                          | Hook                                                        | Location           |
| ----------------------------- | ----------------------------------------------------------- | ------------------ |
| Modal/popover open state      | `useDisclosure`                                             | `shared/lib/hooks` |
| Grid sort (toggle field/dir)  | `useTableSort`                                              | `shared/lib/hooks` |
| Server cursor pagination      | `useCursorPagination`                                       | `shared/lib/hooks` |
| Client offset pagination      | `useClientPagination`                                       | `shared/lib/hooks` |
| Auto-save field FSM           | `useSaveState`                                              | `shared/lib/hooks` |
| Row selection                 | `useRowSelection`                                           | `shared/lib/hooks` |
| Column layout / resize / drag | `useColumnLayout` / `useResizableColumns` / `useColumnDrag` | `shared/lib/hooks` |
| Date formatting               | `formatDate` / `formatDateTime` / `relativeTime`            | `shared/lib/utils` |
| Error → message               | `errorMessage` / `notify.fromError`                         | `shared/lib/toast` |

Don't re-implement these inline. If you write a `toggleSort` or a `commit<Field>`
handler, check the table above first.

## 6. i18n

All user-facing copy goes through `t()` (i18next). No hardcoded strings in TSX.
(Currently under-adopted — new/edited code must comply; migration is Phase 4.)

## 7. Accessibility

- Icon-only controls require `aria-label` (`IconButton` enforces it in its type).
- Use native semantics / Radix primitives (focus trap, roving focus, Escape) —
  which is why modals/tabs/menus must come from `shared/ui`, not raw divs.

## 8. Naming

- Dismiss callback is `onClose` (not `onCancel`/`onDismiss`).
- Native a11y attr is `aria-label` (not a custom `ariaLabel` prop).
- Size scale is `sm | md | lg` across components.
- Form controls forward refs.

---

### PR checklist (paste into description)

- [ ] No file > 500 lines; no component defined inside a `*-page.tsx`.
- [ ] No raw `<button>` / `<table>` / `window.confirm` in the diff.
- [ ] Grids use `DataTableFrame` + one `ColumnSpec[]`; modals via `AppModal`; tabs via `Tabs`.
- [ ] No static-colour inline `style`; colours via tokens; sizes via `text-ui-*`.
- [ ] Status via `StatusBadge`; toasts via `notify`; shared logic via the hooks above.
- [ ] Cross-slice imports only through a slice `index.ts`; user strings via `t()`.
- [ ] Ratchet tests still green (counts did not rise).
