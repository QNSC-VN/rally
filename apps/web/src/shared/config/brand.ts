/**
 * Rally brand color palette as JS constants.
 * Single source of truth — mirrors CSS custom properties in globals.css.
 * Use these in inline `style` props where Tailwind classes cannot reach.
 */
export const BRAND = {
  // ── Core palette ────────────────────────────────────────────────────────────
  primary: '#1d3f73',        // navy — buttons, active states
  primaryHover: '#163260',
  primaryLight: '#2558a6',   // links, secondary actions
  primaryLighter: '#eef3fb', // subtle tinted backgrounds

  // ── Backgrounds ─────────────────────────────────────────────────────────────
  pageBg: '#f0f2f5',
  surface: '#ffffff',
  surfaceHover: '#f7f8fa',
  surfaceSubtle: '#f4f6f9',

  // ── Text ────────────────────────────────────────────────────────────────────
  textPrimary: '#1a2234',
  textSecondary: '#5c6478',
  textMuted: '#8c94a6',

  // ── Borders ─────────────────────────────────────────────────────────────────
  border: '#d9dee7',
  borderSubtle: '#e2e6eb',
  borderInner: '#edf0f4',

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
} as const
