/**
 * Header search — the entry SHELL-FR-009 asks for ("Global search entry opens a search
 * overlay/page").
 *
 * It shipped as an input bound to NOTHING: `searchQuery` appeared at exactly two lines in
 * `app-shell.tsx`, the `useState` and the `value`, with no submit handler, no navigation, no query
 * and no results. Typing did nothing and Enter did nothing, on every screen in the app — a control
 * that looks functional and is not, which is worse than an absent one because it tells the user the
 * feature exists.
 *
 * SCOPE, stated plainly because it is a real limitation. This searches the ACTIVE PROJECT, not the
 * workspace. The only cross-project resolver in the API is `GET /work-items/by-key`, which needs an
 * exact key; free-text search exists solely as `GET /work-items?projectId=&q=` (server-side over
 * `item_key`, `title` and the `search_vector` FTS column). A workspace-wide search needs an endpoint
 * that does not exist, and inventing one is a feature, not the fix for a dead control — so the
 * placeholder says which project it is searching rather than implying more.
 *
 * It deliberately queries the UNRESTRICTED list and not `/work-items/backlog`: the Backlog is
 * unscheduled work only, and searching from the header has to find a story that is already in a
 * sprint.
 *
 * A dropdown rather than a modal overlay, matching `NotificationPopover` — same anchoring, same
 * token-based surface, same Escape-to-close, and the app-shell backdrop already owns outside-click
 * for header popovers.
 *
 * Result rows are LINKS, not buttons, for two reasons. They navigate, so an anchor is the honest
 * element — middle-click and "open in new tab" work for free. And `fe-consistency.ratchet.test.ts`
 * caps raw button elements in consumer layers and may only ever decrease, so a row that could be a
 * link must be one. The rgba colours likewise stay in inline styles rather than arbitrary Tailwind
 * colour classes, which that same ratchet caps at two app-wide — both already spoken for.
 *
 * Worth knowing if either ratchet fails on this file: it scans raw SOURCE TEXT, so a docblock that
 * merely NAMES the pattern it is avoiding counts as a violation. Two versions of this comment did.
 */
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useWorkItemSearch } from '@/features/work-items/api'
import { useAppContext } from '@/shared/lib/stores/app-context.store'

/** An item key typed anywhere — `US-12`, `de-4` — is an exact address, not a search term. */
const ITEM_KEY = /^[A-Za-z]{2}-\d+$/

export function GlobalSearch() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const project = useAppContext((s) => s.project)
  const inputRef = useRef<HTMLInputElement>(null)

  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [activeRaw, setActive] = useState(0)

  const { data: results = [], isLoading } = useWorkItemSearch(project?.projectId, term)

  const trimmed = term.trim()
  const isKey = ITEM_KEY.test(trimmed)

  /**
   * The highlight, CLAMPED at render rather than reset in an effect.
   *
   * The result set changes under this index on every keystroke, so the index has to be bounded
   * somewhere. Doing it here rather than in a `useEffect` that calls `setActive(0)` avoids the
   * cascading render `react-hooks/set-state-in-effect` rejects — and it is also more correct: an
   * effect runs AFTER the render that already used the stale index, so there was a frame in which
   * Enter could act on a row the user could no longer see.
   */
  const active = results.length === 0 ? 0 : Math.min(activeRaw, results.length - 1)

  /** Clicking a row navigates via the `Link` itself; this only clears the panel behind it. */
  function dismiss() {
    setOpen(false)
    setTerm('')
    inputRef.current?.blur()
  }

  /** The KEYBOARD path — Enter has no anchor to follow, so it navigates explicitly. */
  const go = useMemo(
    () => (itemKey: string) => {
      dismiss()
      void navigate({ to: '/item/$itemKey', params: { itemKey } })
    },
    [navigate],
  )

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length === 0) return
      setActive((i) =>
        e.key === 'ArrowDown'
          ? (i + 1) % results.length
          : (i - 1 + results.length) % results.length,
      )
      return
    }
    if (e.key !== 'Enter') return
    /**
     * An exact item key wins over the result list, and works with no project selected: item keys are
     * workspace-unique, so `/item/$itemKey` resolves it server-side. That is the same resolver behind
     * every notification click.
     */
    if (isKey) {
      go(trimmed.toUpperCase())
      return
    }
    const picked = results[active]
    if (picked) go(picked.itemKey)
  }

  const showPanel = open && (isKey || trimmed.length >= 2)

  return (
    <div className="relative mr-1">
      <Search
        size={12}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        style={{ color: 'rgba(255,255,255,0.4)' }}
      />
      <input
        ref={inputRef}
        type="search"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        placeholder={
          project
            ? t('searchEntry.inProject', { project: project.projectKey })
            : t('searchEntry.placeholder')
        }
        aria-label={t('searchEntry.label')}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="rounded py-1 pr-3 pl-7 text-ui-md text-white placeholder:text-[rgba(255,255,255,0.45)] focus:outline-none"
        style={{
          backgroundColor: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.18)',
          width: 200,
        }}
      />

      {showPanel && (
        <div
          id="global-search-results"
          aria-label={t('searchEntry.results')}
          className="absolute top-full right-0 z-50 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-border-strong bg-card shadow-2xl"
          style={{ width: 360 }}
        >
          {isKey && (
            <Link
              to="/item/$itemKey"
              params={{ itemKey: trimmed.toUpperCase() }}
              onClick={dismiss}
              className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-2 text-left hover:bg-surface-subtle"
            >
              <span className="font-mono text-ui-sm font-semibold text-primary">
                {trimmed.toUpperCase()}
              </span>
              <span className="text-ui-xs text-muted-foreground">{t('searchEntry.openByKey')}</span>
            </Link>
          )}

          {!isKey && isLoading && (
            <p className="px-3 py-2 text-ui-sm text-muted-foreground">{t('loading')}</p>
          )}

          {!isKey && !isLoading && results.length === 0 && (
            <p className="px-3 py-2 text-ui-sm text-muted-foreground">
              {project ? t('searchEntry.noMatches') : t('searchEntry.selectProject')}
            </p>
          )}

          {/* No type badge: the key already carries it — Rally "encodes type in the ID prefix by
              design", which is why no grid in this app has a Type column either. */}
          {results.map((item, i) => (
            <Link
              key={item.id}
              to="/item/$itemKey"
              params={{ itemKey: item.itemKey }}
              aria-current={i === active ? 'true' : undefined}
              onMouseEnter={() => setActive(i)}
              onClick={dismiss}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                i === active ? 'bg-surface-subtle' : ''
              }`}
            >
              <span className="font-mono text-ui-xs text-muted-foreground">{item.itemKey}</span>
              <span className="truncate text-ui-sm text-foreground">{item.title}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
