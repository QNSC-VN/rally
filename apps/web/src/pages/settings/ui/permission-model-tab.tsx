/**
 * Settings > Permission Model — read-only capability baseline.
 * Replaces the deleted Roles tab. SRS Phase 4.3 §7.
 * Visible to WA + Project Admin (gated on PROJECT_EDIT).
 */
import { Card, CardBody, CardHeader } from '@/shared/ui/card'
import {
  PanelTable,
  PanelTableCell,
  PanelTableRow,
  type PanelTableColumn,
} from '@/shared/ui/table/panel-table'
import { EMPTY_VALUE } from '@/shared/lib/utils'
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
  // The row directly above and this one are the pair §3.2 gives an Editor DIFFERENT access to, and
  // the reason `timebox:view` exists: one code used to gate both, so an Editor saw a surface
  // the BA hides. Listed here because this table is where an admin reads the model, and it omitted
  // the only Plan surface in the product.
  { feature: 'Plan > Timeboxes (Iterations, Releases)', wa: true, admin: true, editor: false },
  { feature: 'Quality / Defects', wa: true, admin: true, editor: ['view'] },
  {
    feature: 'Portfolio Items (Epic/Feature)',
    wa: true,
    admin: ['create', 'edit', 'archive'],
    editor: false,
  },
  {
    feature: 'Capacity Planning',
    wa: true,
    admin: ['manage', 'publish'],
    editor: false,
  },
  { feature: 'Release Tracking', wa: true, admin: true, editor: false },
  { feature: 'Reports', wa: true, admin: true, editor: false },
  { feature: 'Team Status', wa: true, admin: true, editor: ['view'] },
  { feature: 'Milestones', wa: true, admin: ['create', 'edit', 'delete'], editor: false },
  { feature: 'Project Settings', wa: true, admin: false, editor: false },
  { feature: 'User / Team / Access Management', wa: true, admin: false, editor: false },
]

/**
 * `EMPTY_VALUE` (`--`) for "this level holds nothing", never an em-dash.
 *
 * This function returned `'—'` for an absent capability, which is the one thing `EMPTY_VALUE`'s own
 * docblock forbids ("not an em-dash, because that is what real Rally renders"), and this was the
 * only file in Settings still doing it. It matters here more than in most places: the cell sits in a
 * table whose other rows print real capability lists, so a glyph that renders differently from every
 * other absent value in the product reads as a third state rather than as "none".
 *
 * The rule is about the PLACEHOLDER, not the character: `Backlog — Work Items` is a capability name
 * and the summary sentence above uses an em-dash as punctuation. Both are ordinary typography and
 * neither is a value standing in for something absent.
 */
function renderCell(value: boolean | Action[]): string {
  if (value === true) return 'Full'
  if (Array.isArray(value)) return value.join(', ')
  return EMPTY_VALUE
}

/**
 * One column per access level, declared once for the heading and the cells alike.
 *
 * `feature` is the flexible column and every level column is fixed, so a long feature name yields
 * instead of squeezing the three level headings — `Workspace Admin` is the longest label on the
 * screen and was the one at risk of wrapping.
 */
const MODEL_COLUMNS: PanelTableColumn[] = [
  { key: 'feature', label: 'Feature' },
  { key: 'wa', label: 'Workspace Admin', width: 148, align: 'center' },
  { key: 'admin', label: 'Admin', width: 132, align: 'center' },
  { key: 'editor', label: 'Editor', width: 132, align: 'center' },
]

/** The three levels, as the summary cards above the table. */
const LEVELS = [
  {
    name: 'Workspace Admin',
    tone: 'text-primary',
    description: 'Company authority. Manages users, Projects, Teams, access. Not a Project member.',
  },
  {
    name: 'Admin',
    tone: 'text-success',
    description: 'Per-Project. All Teams. Full delivery admin. No structural admin.',
  },
  {
    name: 'Editor',
    tone: 'text-warning',
    description: 'Per-Project + assigned Teams. Create/edit/delete team-scoped work.',
  },
]

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
          <Card>
            <CardHeader title="3-Level Access Model" />
            <CardBody className="space-y-3">
              <p className="text-ui-sm text-foreground-subtle">
                Authorization is fixed — no custom roles or permission matrix editor.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {LEVELS.map((level) => (
                  <div key={level.name} className="rounded-md border border-border-subtle p-3">
                    <p className={`text-ui-sm font-semibold ${level.tone}`}>{level.name}</p>
                    <p className="mt-1 text-ui-xs text-foreground-subtle">{level.description}</p>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Capability table */}
          <Card>
            <PanelTable columns={MODEL_COLUMNS}>
              {CAPABILITIES.map((cap) => (
                <PanelTableRow key={cap.feature} className="min-h-0 py-2 last:border-b-0">
                  <PanelTableCell column={MODEL_COLUMNS[0]} className="text-ui-sm text-foreground">
                    {cap.feature}
                  </PanelTableCell>
                  {(
                    [
                      [MODEL_COLUMNS[1], cap.wa],
                      [MODEL_COLUMNS[2], cap.admin],
                      [MODEL_COLUMNS[3], cap.editor],
                    ] as const
                  ).map(([column, value]) => (
                    <PanelTableCell
                      key={column.key}
                      column={column}
                      className="text-ui-sm text-foreground-subtle"
                    >
                      {renderCell(value)}
                    </PanelTableCell>
                  ))}
                </PanelTableRow>
              ))}
            </PanelTable>
          </Card>

          {/* No Access note */}
          <Card>
            <CardHeader title="No Access" />
            <CardBody>
              <p className="text-ui-sm text-foreground-subtle">
                Projects you have no access to are hidden from lists, pickers, and navigation.
                Direct URLs are denied (403). Access changes take effect on your next request.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
