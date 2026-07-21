// lint-staged config for rally-web.
//
// eslint + prettier run only on the staged files. The typecheck step is a
// static command (no file list interpolated), so lint-staged runs it ONCE
// project-wide whenever any .ts/.tsx is staged — this is the guard that the
// per-file hook was missing (a moved symbol can leave a dangling type
// reference that eslint won't catch but tsc will; see the HEADER_META fix).
export default {
  '*.{ts,tsx}': (files) => [
    `eslint --fix --max-warnings=0 --no-warn-ignored ${files.join(' ')}`,
    `prettier --write ${files.join(' ')}`,
    'tsc --noEmit',
  ],
  '*.{json,css,md}': 'prettier --write',
}
