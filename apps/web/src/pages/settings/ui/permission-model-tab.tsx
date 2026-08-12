/**
 * Settings > Permission Model — read-only capability baseline.
 * Replaces the deleted Roles tab. SRS Phase 4.3 §7.
 * Visible to WA + Project Admin (gated on PROJECT_EDIT).
 */
import { SettingsTabHeader } from './settings-tab-header'

type Action = string

interface Capability {
  feature: string
  wa: boolean | Action[]
  admin: boolean | Action[]
  editor: boolean | Action[]
}

const CAPABILITIES: Capability[] = [
  { feature: 'Backlog — Work Items', wa: true, admin: true, editor: ['create', 'edit', 'delete'] },
  { feature: 'Iteration Status', wa: true, admin: true, editor: ['edit'] },
  { feature: 'Quality / Defects', wa: true, admin: true, editor: ['create', 'edit', 'delete'] },
  {
    feature: 'Portfolio Items (Epic/Feature)',
    wa: true,
    admin: ['create', 'edit', 'archive'],
    editor: false,
  },
  { feature: 'Capacity Planning', wa: true, admin: ['manage', 'publish'], editor: ['view'] },
  { feature: 'Release Tracking', wa: true, admin: true, editor: false },
  { feature: 'Reports', wa: true, admin: true, editor: true },
  { feature: 'Team Status', wa: true, admin: true, editor: ['edit'] },
  { feature: 'Milestones', wa: true, admin: ['create', 'edit', 'delete'], editor: false },
  { feature: 'Project Settings', wa: true, admin: false, editor: false },
  { feature: 'User / Team / Access Management', wa: true, admin: false, editor: false },
]

function renderCell(value: boolean | Action[]): string {
  if (value === true) return 'Full'
  if (value === false) return '—'
  if (Array.isArray(value)) return value.join(', ')
  return '—'
}

export function PermissionModelTab() {
  return (
    <>
      <SettingsTabHeader
        contained
        title="Permission Model"
        description="The fixed capability baseline for the 3-level access model."
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {/* Model summary */}
          <div className="space-y-2 rounded-lg border border-border-subtle p-4">
            <h3 className="text-ui-sm font-semibold text-foreground">3-Level Access Model</h3>
            <p className="text-ui-sm text-foreground-subtle">
              Authorization is fixed — no custom roles or permission matrix editor.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-border-subtle p-3">
                <p className="text-ui-sm font-semibold text-primary">Workspace Admin</p>
                <p className="mt-1 text-ui-xs text-foreground-subtle">
                  Company authority. Manages users, Projects, Teams, access. Not a Project member.
                </p>
              </div>
              <div className="rounded-md border border-border-subtle p-3">
                <p className="text-ui-sm font-semibold text-success">Admin</p>
                <p className="mt-1 text-ui-xs text-foreground-subtle">
                  Per-Project. All Teams. Full delivery admin. No structural admin.
                </p>
              </div>
              <div className="rounded-md border border-border-subtle p-3">
                <p className="text-ui-sm font-semibold text-warning">Editor</p>
                <p className="mt-1 text-ui-xs text-foreground-subtle">
                  Per-Project + assigned Teams. Create/edit/delete team-scoped work.
                </p>
              </div>
            </div>
          </div>

          {/* Capability table */}
          <div className="overflow-hidden rounded-lg border border-border-subtle">
            <div className="grid grid-cols-[1fr_repeat(3,1fr)] border-b border-border-subtle bg-surface-hover px-4 py-2 text-ui-xs font-semibold tracking-wide text-foreground-subtle uppercase">
              <span>Feature</span>
              <span className="text-center">Workspace Admin</span>
              <span className="text-center">Admin</span>
              <span className="text-center">Editor</span>
            </div>
            {CAPABILITIES.map((cap) => (
              <div
                key={cap.feature}
                className="grid grid-cols-[1fr_repeat(3,1fr)] border-b border-border-subtle px-4 py-2 text-ui-sm last:border-b-0"
              >
                <span className="text-foreground">{cap.feature}</span>
                <span className="text-center text-foreground-subtle">{renderCell(cap.wa)}</span>
                <span className="text-center text-foreground-subtle">{renderCell(cap.admin)}</span>
                <span className="text-center text-foreground-subtle">{renderCell(cap.editor)}</span>
              </div>
            ))}
          </div>

          {/* No Access note */}
          <div className="rounded-lg border border-border-subtle p-4">
            <h3 className="text-ui-sm font-semibold text-foreground">No Access</h3>
            <p className="mt-1 text-ui-sm text-foreground-subtle">
              Projects you have no access to are hidden from lists, pickers, and navigation. Direct
              URLs are denied (403). Access changes take effect on your next request.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
