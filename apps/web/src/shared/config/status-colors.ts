/**
 * Shared shape for an entity status → badge color mapping.
 *
 * The concrete maps live in the owning feature (domain knowledge), e.g.
 * `@/features/releases/status-colors`, so the `shared` layer never depends on
 * `features`. Render with `<StatusBadge style={MAP[value]} />`.
 */
export interface StatusStyle {
  bg: string
  text: string
  border: string
  label: string
}
