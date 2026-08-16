import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'

import { AppModal, ModalBody, ModalFooter } from '@/shared/ui/app-modal'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { SearchableSelect, type SelectOption } from '@/shared/ui/searchable-select'
import { notify } from '@/shared/lib/toast'
import { PortfolioItemType } from '@/entities/work-item/model/types'
import {
  useCreatePortfolioItem,
  usePortfolioItems,
  type PortfolioItemState,
  type PreliminaryEstimateSize,
} from '@/features/portfolio/api'
import { useWorkspaceMemberOptions } from '@/features/workspaces/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'
import { useAuthStore } from '@/shared/lib/stores/auth.store'
import { useProjects } from '@/features/projects/api'
import { ProjectCell } from '@/shared/ui/project-cell'
import { TypeBadge } from '@/entities/work-item/ui/badges'
import { OwnerSelectField, TeamSelectField } from '@/shared/ui/entity-select-field'
import { PORTFOLIO_STATES, PRELIMINARY_ESTIMATE_SIZES } from '../model/portfolio-states'
import { usePortfolioCellOptions } from '../model/use-cell-options'

/** An Epic option with the glyph the Portfolio detail sidebar's own Epic picker uses. */
const epicOption = (e: { id: string; itemKey: string; name: string }): SelectOption => ({
  value: e.id,
  label: `${e.itemKey} — ${e.name}`,
  searchText: `${e.itemKey} ${e.name}`,
  icon: <TypeBadge type={PortfolioItemType.Epic} size={16} />,
})

/**
 * Create an Epic or a Feature.
 *
 * `type` is fixed by the caller (the list's current level) rather than being a field in
 * here: it is immutable after create, and the API has no combined view, so offering it as
 * a dropdown would let someone create an Epic while looking at the Feature list and
 * wonder where it went.
 *
 * The parent-Epic picker only appears for a Feature — an Epic has no parent by CHECK
 * constraint (`ck_portfolio_epic_shape`), so showing a disabled field would imply the
 * hierarchy goes deeper than two levels.
 */
export function CreatePortfolioItemModal({
  projectId,
  type,
  fixedParentId,
  onClose,
  onCreated,
}: {
  projectId: string
  type: PortfolioItemType
  /**
   * Pre-selected parent Epic — set by the Epic Children tab, which lists exactly one Epic's children.
   * Narrows the EPIC picker to a single option rather than disabling it: a child filed under a
   * different Epic would vanish from the grid that created it.
   *
   * It used to narrow the Project picker as well; that picker is gone, and this caller passes the
   * Epic's own `projectId`, so the read-only display is already correct for it.
   */
  fixedParentId?: string
  onClose: () => void
  /**
   * The id of the item just created, for the caller to reveal in its grid.
   *
   * Needed because a new item is ranked LAST: on a populated list it lands on a page the user
   * is not looking at, so a plain Create looked like it had done nothing.
   */
  onCreated?: (id: string) => void
}) {
  const { t } = useTranslation('portfolio')
  const navigate = useNavigate()
  const create = useCreatePortfolioItem()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<PortfolioItemState>('no_entry')
  const [size, setSize] = useState<PreliminaryEstimateSize>('no_entry')
  const [parentId, setParentId] = useState(fixedParentId ?? '')
  /**
   * Owner, Team and Target Release — the three fields the create modal never had.
   *
   * §66 lists them alongside Name, State and Preliminary Estimate, and §344 makes Owner REQUIRED on an
   * Epic. The API has accepted all three since the module shipped; the dialog sent none, so every new
   * item arrived unowned, unteamed and unscheduled and had to be opened and edited to become the thing
   * the planner was describing.
   *
   * Project IS a field here, and it is READ-ONLY — see the display below. This comment used to read
   * "Project is not a field here", which went stale twice over: a live cascading selector was added
   * (on §66's older wording, "Project (select, cascades Team)"), and the BA has since fixed the field
   * read-only at creation.
   */
  const [ownerId, setOwnerId] = useState('')
  const [teamId, setTeamId] = useState('')
  const [releaseId, setReleaseId] = useState('')
  const [errors, setErrors] = useState<{ name?: string; owner?: string; form?: string }>({})

  const isFeature = type === PortfolioItemType.Feature

  /**
   * The project being created INTO — FIXED, from the caller's context, never chosen here.
   *
   * This was a live cascading selector, built from §66 read as "Project (select, cascades Team)" and
   * from the mockup's `selectProject`. The BA has since ruled the field read-only at creation as well
   * as after it: §66 now reads "Project (auto-filled from the current Project context and read-only)",
   * §339 says the same for `New Epic` ("Auto-filled from current Project context; read-only"), and §45
   * completes it with "Inherited from the current Project context at creation and read-only afterward".
   *
   * So there is nothing left to cascade FROM, and `selectProject` — which reset Team, Epic, Release and
   * Owner — is gone with the picker. Both callers already supply exactly the right project: the list
   * page passes the globally selected one, and Epic Detail's `Add Feature` passes the EPIC's own, which
   * is why this reads the prop rather than the app context.
   */
  const activeProjectId = projectId

  const { workspace } = useAppContext()
  const { data: members = [] } = useWorkspaceMemberOptions(workspace?.workspaceId)
  // The SAME per-project Release/Team lists the grid's inline cells offer, so the dialog cannot
  // propose a target the row editor would refuse — both are scoped by the API to the item's project.
  const optionsFor = usePortfolioCellOptions(workspace?.workspaceId, [activeProjectId])
  const { releases, teams } = optionsFor(activeProjectId)

  /**
   * The fixed project's own row, for the read-only display's chip and name.
   *
   * A NAME LOOKUP, so deliberately NOT narrowed by `portfolio:create` the way the old option list was:
   * that narrowing existed to stop the picker offering a project the create would refuse, and applying
   * it to a lookup would blank the label whenever the per-project permission had not resolved yet. The
   * create is still gated — by the API, and by the `canCreate` check that decides whether this dialog
   * opens at all.
   */
  const { data: allProjects = [] } = useProjects(workspace?.workspaceId)
  const activeProject = useMemo(
    () => allProjects.find((p) => p.id === activeProjectId),
    [allProjects, activeProjectId],
  )

  /**
   * Team and Owner OPEN WITH A VALUE rather than blank — the mockup seeds both
   * (`NewFeatureModal` lines 252-253), so a planner who types a name and presses Create gets a
   * usable item instead of one with holes. Team falls back to the project's first team; Owner
   * to the SIGNED-IN user, which is the rule `P1-WID-01` states ("Owner defaults to the
   * authenticated user") — the mockup's `OWNERS[0]` is a static-fixture artefact.
   *
   * Applied as a fallback, not as initial state: both lists arrive asynchronously, so seeding
   * `useState` would leave them empty on first paint.
   */
  const { team: contextTeam } = useAppContext()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const defaultTeamId =
    contextTeam?.teamId && teams.some((tm) => tm.id === contextTeam.teamId)
      ? contextTeam.teamId
      : (teams[0]?.id ?? '')
  const effectiveTeamId = teamId || defaultTeamId
  const effectiveOwnerId =
    ownerId ||
    (currentUserId && members.some((m) => m.userId === currentUserId) ? currentUserId : '')
  // Only Epics in the SAME project are offerable: a Feature's Release must belong to its
  // project, and mixing projects across one Epic makes the rollup span projects in a way
  // the spec does not ask for.
  const { items: epics } = usePortfolioItems({ type: PortfolioItemType.Epic, projectId })

  async function submit(goToDetails: boolean) {
    const next: typeof errors = {}
    if (!name.trim()) next.name = t('create.nameRequired')
    // §344 lists Owner as Required, for an Epic and a Feature alike: a portfolio item with nobody
    // accountable is what the field exists to prevent.
    if (!effectiveOwnerId) next.owner = t('create.ownerRequired')
    if (Object.keys(next).length > 0) {
      setErrors(next)
      return
    }
    setErrors({})
    try {
      const result = await create.mutateAsync({
        projectId: activeProjectId,
        type,
        name: name.trim(),
        description: description.trim() || undefined,
        state,
        preliminaryEstimate: size,
        ownerId: effectiveOwnerId,
        // Team and Release are Feature-only: `ck_portfolio_epic_shape` refuses either on an Epic, and
        // `assertShape` reports that as a 422 rather than a constraint violation.
        ...(isFeature && effectiveTeamId ? { teamId: effectiveTeamId } : {}),
        ...(isFeature && releaseId ? { releaseId } : {}),
        ...(isFeature && parentId ? { parentId } : {}),
      })
      notify.success(t('create.created', { name: name.trim() }))
      onClose()
      if (result?.id) onCreated?.(result.id)
      if (goToDetails && result?.id) {
        void navigate({ to: '/portfolio/$itemId', params: { itemId: result.id } })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('create.createFailed')
      setErrors({ form: msg })
      notify.error(msg)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      title={isFeature ? t('create.titleFeature') : t('create.titleEpic')}
      width={460}
    >
      <ModalBody className="space-y-4">
        {errors.form && (
          <p role="alert" className="text-ui-sm text-destructive">
            {errors.form}
          </p>
        )}

        {/* `htmlFor` + `id` are what actually tie the label to the control — FormField
            renders a bare <label> otherwise, leaving the input unlabelled for screen
            readers (and unfindable by an accessible-name query). */}
        <FormField
          label={t('create.nameLabel')}
          required
          error={errors.name}
          htmlFor="portfolio-name"
        >
          <Input
            id="portfolio-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>

        {/* Project — auto-filled and READ-ONLY (§66, §339, §45). Rendered through the same `ProjectCell`
            the grid's Project column now uses, so the value shown while creating is recognisably the
            value that column will show afterwards. NOT a disabled `SearchableSelect`: a greyed picker
            invites a click and implies the choice exists somewhere. The label drops `required` too —
            the field cannot be empty and cannot be wrong, so an asterisk asks for nothing. */}
        <FormField label={t('create.projectLabel')}>
          <ProjectCell projectKey={activeProject?.key ?? null} projectName={activeProject?.name} />
        </FormField>

        {/* The same controls the detail rail and the work-item create modal use, so an Owner or a Team
            is picked the same way everywhere. */}
        <OwnerSelectField
          label={t('detail.fields.owner')}
          value={effectiveOwnerId}
          members={members}
          required
          error={errors.owner}
          onChange={setOwnerId}
        />

        {isFeature && (
          <div className="flex gap-3">
            <div className="flex-1">
              <TeamSelectField
                label={t('detail.fields.team')}
                value={effectiveTeamId}
                teams={teams}
                onChange={setTeamId}
              />
            </div>
            {/* `Unscheduled` is the BA's own name for the empty choice (§66), and it is a real state:
                a Feature with no Release is planned but not yet dated. */}
            <FormField label={t('detail.fields.release')} className="flex-1">
              <SearchableSelect
                variant="field"
                value={releaseId}
                ariaLabel={t('detail.fields.release')}
                searchPlaceholder="Search"
                options={[
                  { value: '', label: t('create.unscheduled') },
                  ...releases.map((r) => ({
                    value: r.id,
                    label: `${r.releaseKey} — ${r.name}`,
                    searchText: `${r.releaseKey} ${r.name}`,
                    icon: <TypeBadge type="release" size={16} />,
                  })),
                ]}
                onChange={(v) => setReleaseId(v ?? '')}
              />
            </FormField>
          </div>
        )}

        {isFeature && (
          <FormField label={t('detail.fields.parent')}>
            <SearchableSelect
              variant="field"
              value={parentId}
              ariaLabel={t('detail.fields.parent')}
              searchPlaceholder="Search"
              // Opened from an Epic's Children tab: that Epic is the only option, so the field
              // confirms the parent without offering a way to file the child elsewhere.
              options={
                fixedParentId
                  ? epics.filter((e) => e.id === fixedParentId).map(epicOption)
                  : [{ value: '', label: t('create.noEpic') }, ...epics.map(epicOption)]
              }
              onChange={(v) => !fixedParentId && setParentId(v ?? '')}
            />
          </FormField>
        )}

        <div className="flex gap-3">
          <FormField label={t('filters.state')} className="flex-1">
            <SearchableSelect
              variant="field"
              value={state}
              ariaLabel={t('filters.state')}
              options={PORTFOLIO_STATES.map((s) => ({ value: s, label: t(`states.${s}`) }))}
              onChange={(v) => setState(v as PortfolioItemState)}
            />
          </FormField>
          <FormField label={t('detail.fields.preliminaryEstimate')} className="flex-1">
            <SearchableSelect
              variant="field"
              value={size}
              ariaLabel={t('detail.fields.preliminaryEstimate')}
              options={PRELIMINARY_ESTIMATE_SIZES.map((s) => ({
                value: s,
                label: t(`sizes.${s}`),
              }))}
              onChange={(v) => setSize(v as PreliminaryEstimateSize)}
            />
          </FormField>
        </div>

        <FormField label={t('detail.fields.description')} htmlFor="portfolio-description">
          <Textarea
            id="portfolio-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </FormField>
      </ModalBody>

      <ModalFooter>
        <Button variant="outline" type="button" onClick={onClose}>
          {t('common:cancel')}
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => void submit(true)}
        >
          {t('create.createWithDetails')}
        </Button>
        <Button
          type="button"
          disabled={create.isPending || !name.trim()}
          onClick={() => void submit(false)}
        >
          {create.isPending && <Loader2 size={11} className="animate-spin" />}
          {t('create.createButton')}
        </Button>
      </ModalFooter>
    </AppModal>
  )
}
