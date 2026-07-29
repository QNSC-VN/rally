// lint-staged config for rally-web.
//
// eslint + prettier run only on the staged files. The typecheck step is a
// static command (no file list interpolated), so lint-staged runs it ONCE
// project-wide whenever any .ts/.tsx is staged — this is the guard that the
// per-file hook was missing (a moved symbol can leave a dangling type
// reference that eslint won't catch but tsc will; see the HEADER_META fix).
//
// It MUST be `tsc -b`, not `tsc --noEmit`. This package's `tsconfig.json` is a
// solution file (`"files": []` + project references), so `tsc --noEmit` resolves
// to zero input files and exits 0 without reading a single line of `src/` — the
// guard was silently inert. `-b` builds the referenced projects and is what
// actually catches the dangling reference this step exists for.
export default {
  '*.{ts,tsx}': (files) => [
    `eslint --fix --max-warnings=0 --no-warn-ignored ${files.join(' ')}`,
    `prettier --write ${files.join(' ')}`,
    'tsc -b',
  ],
  '*.{json,css,md}': 'prettier --write',
}
