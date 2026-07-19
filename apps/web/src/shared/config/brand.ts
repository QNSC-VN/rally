/**
 * Rally brand palette — a typed accessor over the CSS custom properties defined
 * in `app/styles/globals.css`, which is the SINGLE source of truth for the token
 * values (light in `:root`, dark in `.dark`).
 *
 * Every entry is a `var(--token)` reference, never a hardcoded hex. This keeps
 * the palette in exactly one place (no JS↔CSS duplication to drift) and lets
 * inline `style` / SVG paint follow the light/dark cascade automatically — a
 * baked-in hex could never respond to the `.dark` overrides.
 *
 * Prefer the Tailwind token utilities (`bg-card`, `text-muted-foreground`,
 * `border-border-strong`, …) for static styling. Reach for BRAND only where a
 * class cannot: computed/conditional colors, SVG `fill`/`stroke`, chart series.
 *
 * `app/styles/brand-palette-sync.test.ts` guards that every reference here
 * resolves to a variable that actually exists in `globals.css`.
 */
export const BRAND = {
  // ── Core palette ────────────────────────────────────────────────────────────
  primary: 'var(--primary)', // navy — buttons, active states
  primaryForeground: 'var(--primary-foreground)', // text/icons on a primary fill
  primaryHover: 'var(--primary-hover)',
  primaryDark: 'var(--primary-dark)', // darker navy — detail/header bars on white
  primaryLight: 'var(--primary-light)', // links, secondary actions
  primaryLighter: 'var(--primary-lighter)', // subtle tinted backgrounds

  // ── Accent blue (interactive tints: selection / hover / drag-over) ────────────
  accentBg: 'var(--accent-bg)', // selected / drag-over tint surface
  accentBgSubtle: 'var(--accent-bg-subtle)', // faint hover / unread tint
  accentBorder: 'var(--accent-border)', // accent border on tinted surfaces (selection)
  accentBorderStrong: 'var(--accent-border-strong)', // accent border on white panels
  accentBorderActive: 'var(--accent-border-active)', // accent border — active / drag-over
  tooltipBg: 'var(--tooltip-bg)', // dark tooltip / inverse surface

  // ── Backgrounds ─────────────────────────────────────────────────────────────
  pageBg: 'var(--background)',
  surface: 'var(--card)',
  surfaceHover: 'var(--surface-hover)',
  surfaceSubtle: 'var(--surface-subtle)',
  inputBg: 'var(--input-background)', // form control backgrounds

  // ── Text ────────────────────────────────────────────────────────────────────
  textPrimary: 'var(--foreground)',
  textSecondary: 'var(--muted-foreground)',
  textMuted: 'var(--foreground-subtle)',
  textDisabled: 'var(--foreground-disabled)', // placeholder / disabled text
  textFaint: 'var(--foreground-faint)', // faint hints, empty-state glyphs
  columnHeader: 'var(--foreground-subtle)', // table column header text

  // ── Borders ─────────────────────────────────────────────────────────────────
  border: 'var(--border-strong)',
  borderSubtle: 'var(--border-subtle)',
  borderInner: 'var(--border-inner)',
  borderInput: 'var(--input)', // form control borders

  // ── Avatar / initials ───────────────────────────────────────────────────────
  avatarBg: 'var(--avatar)',
  avatarText: 'var(--avatar-foreground)',

  // ── Semantic ─────────────────────────────────────────────────────────────────
  danger: 'var(--destructive)',
  dangerBg: 'var(--destructive-bg)',
  dangerBorder: 'var(--destructive-border)',
  success: 'var(--success)',
  successBg: 'var(--success-bg)',
  successBorder: 'var(--success-border)',
  warning: 'var(--warning)',
  warningBg: 'var(--warning-bg)',
  warningBorder: 'var(--warning-border)',
  statusDefault: 'var(--status-default)', // default swatch for a new custom status (to-do grey)
} as const
