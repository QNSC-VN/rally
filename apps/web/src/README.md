# `src` — Feature-Sliced Design

Layered, one-directional dependency graph (see `05_Architecture/FRONTEND_STRUCTURE.md §4`).
A layer may import **only** from layers below it:

```
app → pages → widgets → features → entities → shared
```

| Layer | Owns | May import |
|---|---|---|
| **app** | providers, router tree, global error boundary, theme/styles | everything below |
| **pages** | one screen per route; composes widgets; reads route params | widgets ↓ |
| **widgets** | self-contained composite blocks (board, grid, app-shell) | features ↓ |
| **features** | a single user action + its mutation/optimistic logic | entities ↓ |
| **entities** | a domain noun's read model + display components | shared ↓ |
| **shared** | API client, design system (shadcn/ui), utils, config — **no domain** | nothing above |

The import direction is enforced by `eslint-plugin-boundaries` (see `eslint.config.js`).
A `feature` importing another `feature`, or `shared` importing a `feature`, fails lint.

> Note: the `processes`/`pages` distinction from classic FSD is collapsed — TanStack
> Router owns route composition under `app/router`, and `pages/` holds route screens.
