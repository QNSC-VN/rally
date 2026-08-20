# FE-10 — Choose a token's scopes when creating it

## Overview

This feature adds scope selection to the API token creation flow in the Settings screen. The API already supports scoped tokens and intersects the requested scopes with the creator's permissions, but the current UI never sends scopes—every token created through the app inherits the creator's full privileges.

## Problem Statement

Currently, all API tokens created through the Settings screen are unscoped. A token created by a Workspace Admin, for example, carries the full `workspace:*` privilege set even if the intended use case only requires `work_item:read`. This creates an unnecessary security surface: if a scoped token is compromised, the attacker's capabilities are limited to the specific operations the token was designed for.

The narrowing mechanism already exists in the API layer. The issue is that the Settings screen never provides a way to specify scopes, so the API's capability is unreachable.

## Solution

Add a scope selector to the create-token form that:
1. Reads available permission codes from the frontend permission catalogue mirror
2. Allows the user to select zero or more permissions
3. Explains that selecting none inherits the creator's full permissions
4. Sends the selected codes as the `scopes` array on token creation
5. Omits the `scopes` field entirely when no permissions are selected

Additionally, display the scopes on the token list so users can distinguish between unscoped and scoped tokens at a glance.

## Design Considerations

### Permission Catalogue as Authority
The permission catalogue (`db/permissions.catalog.ts`) is the single source of truth for valid permission codes. The form reads the frontend mirror (`apps/web/src/shared/config/permissions.ts`) which contains the subset of permissions used for frontend gating. This is the appropriate source because:
- There is no backend API endpoint to fetch the full catalogue
- Backend changes are out of scope
- The frontend mirror contains permissions users understand and use in the application

If the frontend mirror diverges from the backend catalogue, token creation will fail with a validation error. The UI displays this error clearly so users can report the drift.

### Empty Selection vs. Unselected Field
An empty `scopes` array and an absent `scopes` field have different meanings to the API:
- Absent field: token inherits creator's full permissions
- Empty array: token has no permissions (effectively useless)

The form must omit the field when no permissions are selected, not send an empty array.

### UI Component for Scope Selection
Use a **searchable multi-select dropdown** with the following characteristics:
- Supports text search to filter the ~30 permission options
- Shows permission codes as the display text (e.g., `work_item:view`)
- Renders selected items as removable chips/tags below the selector
- Does NOT show wildcards (`workspace:*`, `work_item:*`) as options — users select individual concrete permissions only

With ~30 options, search makes the selector usable. Individual codes are shown because no human-readable label mapping exists and adding one is out of scope. Wildcards are excluded because they represent "everything in this namespace" — selecting individual permissions is more explicit and auditable.

### Backend Compatibility
No backend changes are required. The API already accepts and processes the `scopes` parameter correctly. This is purely a frontend enhancement to expose existing capability.

### Displaying Scopes in the Token List
Add a new **"Scopes"** column to the token list with the following display rules:
- If `scopes` is `null`: display "Full access" (inherits your permissions)
- If `scopes` is an array:
  - Empty array: display "No permissions" (theoretical edge case)
  - 1-2 permissions: display comma-separated codes (e.g., "work_item:view, work_item:create")
  - 3+ permissions: display "X scopes" where X is the count, with a tooltip showing the full list on hover

### Error Handling
The permission catalogue mirror is a static TypeScript file bundled with the frontend, so there is no runtime fetch and no error handling needed for the catalogue itself. If the file is missing or malformed, the build fails before the app runs.

The only network-dependent operation is the token creation itself. If the API rejects a permission code (because the frontend mirror diverged from the backend catalogue), the error response will indicate which code was invalid. The UI displays this error to the user.

### Affected Area
- `apps/web/src/pages/settings` — the settings screens where tokens are managed

## User Flow

### Creating a Scoped Token
1. User navigates to Settings → API Tokens
2. User clicks "Create Token"
3. Form opens with a new "Scopes" section containing a searchable multi-select dropdown
4. User types to search (e.g., "work") and sees matching permission codes (e.g., `work_item:view`, `work_item:create`)
5. User selects the permissions the token needs by clicking options
6. Selected permissions appear as removable chips below the selector
7. User fills in other required fields (name, expiration)
8. User submits the form
9. Request includes the selected codes in the `scopes` array
10. Created token's scopes match the selection

### Creating an Unscoped Token
1. User navigates to Settings → API Tokens
2. User clicks "Create Token"
3. Form opens with the "Scopes" section showing an empty dropdown
4. Helper text below the dropdown explains: "Select permissions to limit this token's capabilities. If none are selected, the token will inherit your full permissions."
5. User leaves scopes unselected and fills in other fields
6. User submits the form
7. Request omits the `scopes` field entirely
8. Created token has no scope restrictions (full access)

### Viewing Token Scopes
1. User navigates to Settings → API Tokens
2. Token list displays each token's scopes in a new "Scopes" column
3. Unscoped tokens show "Full access"
4. Scoped tokens with 1-2 permissions show comma-separated codes
5. Scoped tokens with 3+ permissions show "X scopes" where X is the count
6. Hovering over "X scopes" shows a tooltip with the full list of permission codes
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
- Wildcard permission selection
