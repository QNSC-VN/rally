/**
 * Rally brand color palette as JS constants.
 *
 * Typed mirror of the CSS custom properties in `app/styles/globals.css`.
 * Use these in inline `style` props / SVG `fill`/`stroke` where Tailwind classes
 * (and `var()`) cannot reliably reach; use the Tailwind token utilities
 * (`bg-card`, `text-muted-foreground`, `border-border-strong`, …) everywhere else.
 *
 * The semantic tokens below (primary, surfaces, text, borders, danger, success,
 * warning) are kept byte-for-byte in sync with their `--css-var` counterparts by
 * `app/styles/brand-palette-sync.test.ts` — update both together or the test fails.
 */
export const BRAND = {
  // ── Core palette ────────────────────────────────────────────────────────────
  primary: '#1d3f73', // navy — buttons, active states
  primaryHover: '#163260',
  primaryLight: '#2558a6', // links, secondary actions
  primaryLighter: '#eef3fb', // subtle tinted backgrounds

  // ── Backgrounds ─────────────────────────────────────────────────────────────
  pageBg: '#f0f2f5',
  surface: '#ffffff',
  surfaceHover: '#f7f8fa',
  surfaceSubtle: '#f4f6f9',
  inputBg: '#f4f6f9', // form control backgrounds

  // ── Text ────────────────────────────────────────────────────────────────────
  textPrimary: '#1a2234',
  textSecondary: '#5c6478',
  textMuted: '#8c94a6',
  textDisabled: '#a0a7b5', // placeholder / disabled text
  textFaint: '#c4cad4', // faint hints, empty-state glyphs
  columnHeader: '#8c94a6', // table column header text

  // ── Borders ─────────────────────────────────────────────────────────────────
  border: '#d9dee7',
  borderSubtle: '#e2e6eb',
  borderInner: '#edf0f4',
  borderInput: '#d7dde7', // form control borders

  // ── Avatar / initials ───────────────────────────────────────────────────────
  avatarBg: '#e5ebf4',
  avatarText: '#1d3f73',

  // ── Sidebar ─────────────────────────────────────────────────────────────────
  sidebar: '#162d56',
  sidebarFg: 'rgba(255,255,255,0.65)',
  sidebarFgActive: '#ffffff',
  sidebarActive: 'rgba(255,255,255,0.16)',
  sidebarHover: 'rgba(255,255,255,0.08)',
  sidebarDivider: 'rgba(255,255,255,0.08)',

  // ── Semantic ─────────────────────────────────────────────────────────────────
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#f0c7c1',
  success: '#1e6930',
  successBg: '#eaf5ed',
  successBorder: '#c7e4ce',
  warning: '#d97706',
  warningBg: '#fef5e4',
  warningBorder: '#f0d9a5',
} as const
