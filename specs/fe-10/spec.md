# FE-10 — Choose a token's scopes when creating it

## Overview

This feature adds scope selection to the API token creation flow in the Settings screen. The API already supports scoped tokens and intersects the requested scopes with the creator's permissions, but the current UI never sends scopes—every token created through the app inherits the creator's full privileges.

## Problem Statement

Currently, all API tokens created through the Settings screen are unscoped. A token created by a Workspace Admin, for example, carries the full `workspace:*` privilege set even if the intended use case only requires `work_item:read`. This creates an unnecessary security surface: if a scoped token is compromised, the attacker's capabilities are limited to the specific operations the token was designed for.

The narrowing mechanism already exists in the API layer. The issue is that the Settings screen never provides a way to specify scopes, so the API's capability is unreachable.

## Solution

Add a scope selector to the create-token form that:
1. Reads available permission codes from the caller's own permissions stored in `auth.store.ts` (which is populated at bootstrap from `/v1/bff/me`)
2. Excludes any permission whose value contains `:*` (wildcards defeat narrowing)
3. Allows the user to select zero or more permissions
4. Explains that selecting none inherits the creator's full permissions
5. Sorts selected scopes alphabetically for deterministic display
6. Sends the selected codes as the `scopes` array on token creation
7. Omits the `scopes` field entirely when no permissions are selected
8. Displays validation errors inline below the scope selector using FormField's `error` prop
9. Fixes the token name `maxLength` from 80 to 100 to match the API DTO

Additionally, display the scopes on the token list so users can distinguish between unscoped and scoped tokens at a glance.

## Design Considerations

### Permission Source

**The scope selector reads ONLY the permissions the caller currently holds, not the whole catalogue.** Scopes can only narrow — the effective set is the owner's permissions intersected with the selection — so offering a permission the user does not hold would produce a token that appears to grant something it can never grant.

The form reads the caller's own permissions from `auth.store.ts`, which holds `permissions: string[]` for the current user. This store is populated at bootstrap by `auth-bootstrap.ts` from the `/v1/bff/me` endpoint, so the data is present before the modal opens. There is no additional API call needed, no caching question, no invalidation question, and no loading state to manage.

### Empty Selection vs. Unselected Field

An empty `scopes` array and an absent `scopes` field have different meanings to the API:
- Absent field: token inherits creator's full permissions
- Empty array: token has no permissions (effectively useless)

The form must omit the field when no permissions are selected, not send an empty array.

### UI Component for Scope Selection

Use the existing **`SearchableSelect` component** from `@/shared/ui/searchable-select` with the following configuration:
- `multiple={true}` - enables multi-select mode with checkboxes
- `variant="field"` - form-style appearance (bordered box, not grid-cell style)
- Permission codes as the display text (e.g., `work_item:view`)
- Renders selected items as removable chips below the selector
- Search box with placeholder "Search permissions…"
- Auto-groups options into "Selected" / "Available" buckets (built-in behavior)

The permission options come from `auth.store.ts`, which already contains the user's resolved permissions. With ~24 permission options (for a user with broad permissions), search makes the selector usable. Individual codes are shown because no human-readable label mapping exists and adding one is out of scope.

### Wildcard Permissions

**Exclude any permission whose value contains `:*`, not just `workspace:*` by value.** A wildcard scope defeats the narrowing this field exists for, and keying on the pattern rather than one literal means a new wildcard added to the catalogue later is excluded without anyone remembering to come back here.

### Permission Ordering

Permissions in the dropdown should be ordered alphabetically by their code to make them findable.

**Sort selected scopes alphabetically when displayed.** Selection order carries no meaning, and deterministic rendering is what makes the row assertable in a test and scannable by a person.

### Backend Compatibility

No backend changes are required. The API already accepts and processes the `scopes` parameter correctly. This is purely a frontend enhancement to expose existing capability.

### Displaying Scopes in the Token List

Add a new **"Scopes"** column to the token list. **The column should be positioned after the "Name" column and before the "Status" column.** This places identity information together (name, scopes, status) before temporal information (last used, actions).

Display rules (using i18n keys from `settings.json`):
- If `scopes` is `null`: display `t('apiTokens.scopes.fullAccess')` ("Full access")
- If `scopes` is an array:
  - Empty array: display `t('apiTokens.scopes.noPermissions')` ("No permissions")
  - 1-2 permissions: display comma-separated codes (e.g., "work_item:view, work_item:create")
  - 3+ permissions: display `t('apiTokens.scopes.count', { count })` ("X scopes")

**Use the existing Tooltip component from `apps/web/src/shared/ui/tooltip.tsx`. Show ALL scopes in the tooltip, not only the overflow:** the tooltip is the only place the full set is legible, and a reader who has to combine what is visible with what is hidden is doing the component's work.

### Error Handling

Since permissions are read from `auth.store.ts` (which is populated at bootstrap), there is no network fetch and no loading state for the permission list. The data is present before the modal opens.

The only network-dependent operation is the token creation itself. If the API rejects a permission code (because the store's permissions contain a code the API no longer recognizes), the error response will indicate which code was invalid. The UI displays this error inline below the scope selector using FormField's `error` prop, which is the convention for field validation everywhere else in this codebase. A toast is for something that happened elsewhere; this is about the field the user is looking at.

### Token Name Length

The `CreateTokenModal` currently enforces `maxLength={80}` on the name field, but the backend API DTO specifies `max(100)`. The DTO is the authority (name: z.string().trim().min(1).max(100)). The maxLength={80} in create-token-modal.tsx is a defect that will be fixed to 100 as part of this story.

### Search Behavior

The `SearchableSelect` component uses case-insensitive substring matching (`.toLowerCase().includes()`). This default behavior is appropriate for permission codes.

### Affected Area
- `apps/web/src/pages/settings` — the settings screens where tokens are managed

## User Flow

### Creating a Scoped Token
1. User navigates to Settings → API Tokens
2. User clicks "Create Token"
3. Form opens with a new "Scopes" section containing a searchable multi-select dropdown
4. Form reads the caller's permissions from `auth.store.ts` to populate the dropdown options
5. Dropdown displays only permissions the user actually holds, sorted alphabetically
6. User types to search (e.g., "work") and sees matching permission codes (e.g., `work_item:view`, `work_item:create`)
7. User selects the permissions the token needs by clicking options
8. Selected permissions appear as removable chips below the selector, sorted alphabetically
9. User fills in other required fields (name, expiration)
10. User submits the form
11. Request includes the selected codes in the `scopes` array
12. Created token's scopes match the selection

### Creating an Unscoped Token
1. User navigates to Settings → API Tokens
2. User clicks "Create Token"
3. Form opens with the "Scopes" section showing an empty dropdown
4. Helper text below the dropdown explains: `t('apiTokens.create.scopesHint')` - "Search and select permissions to limit this token's capabilities. If none are selected, the token will inherit your full permissions."
5. User leaves scopes unselected and fills in other fields
6. User submits the form
7. Request omits the `scopes` field entirely
8. Created token has no scope restrictions (full access)

### Viewing Token Scopes
1. User navigates to Settings → API Tokens
2. Token list displays each token's scopes in a new "Scopes" column (positioned after Name, before Status)
3. Unscoped tokens show "Full access"
4. Scoped tokens with 1-2 permissions show comma-separated codes
5. Scoped tokens with 3+ permissions show "X scopes" where X is the count
6. Hovering over "X scopes" shows a Tooltip from `apps/web/src/shared/ui/tooltip.tsx` with the full list of permission codes (all scopes, not just the overflow)
7. Users can at a glance distinguish between full-privilege and narrowed tokens

## Acceptance Criteria

See `plan.json` for the detailed acceptance criteria with test tags.

## Out of Scope

- Modifying the API's scope intersection logic (already implemented)
- Changing the permission catalogue structure
- Token editing or scope modification after creation
- Scope selection for tokens created through other means (e.g., API directly)
- Permissions beyond what the API token endpoints already support
- Human-readable permission labels
- Wildcard permission selection (excluded by pattern `:*`, not just `workspace:*`)

## Open Questions

None. All design questions have been resolved through the review process:

1. **Permission filtering**: Scope selector shows ONLY the permissions the caller currently holds from `auth.store.ts`, not the whole catalogue. The effective set is the owner's permissions intersected with the selection.
2. **Wildcard exclusion rule**: Exclude any permission whose value contains `:*`, not just `workspace:*` by value.
3. **Selected scope ordering**: Sort selected scopes alphabetically when displayed.
4. **Tooltip implementation**: Use the existing Tooltip from `apps/web/src/shared/ui/tooltip.tsx`. Show ALL scopes in the tooltip, not only the overflow.
5. **Error display location**: Display the error inline below the scope selector using FormField's `error` prop.
6. **Token name length**: Maximum is 100 characters per the API DTO. The form's `maxLength={80}` is a defect that will be fixed.
7. **Scope selector component**: Use SearchableSelect from `apps/web/src/shared/ui/searchable-select` with `multiple={true}` and `variant='field'`.
8. **Permission data source**: Read from `auth.store.ts` (which holds `permissions: string[]`), not from the API or from `permissions.ts`. The data is present before the modal opens, populated at bootstrap from `/v1/bff/me`.
