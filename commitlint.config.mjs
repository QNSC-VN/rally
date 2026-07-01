/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // type-enum: enforce our project's allowed types
    'type-enum': [
      2,
      'always',
      [
        'feat',     // new feature
        'fix',      // bug fix
        'chore',    // tooling, deps, config
        'docs',     // documentation only
        'style',    // formatting, no logic change
        'refactor', // code change that neither fixes nor adds a feature
        'perf',     // performance improvement
        'security', // security fix or hardening
        'test',     // adding or fixing tests
        'build',    // build system or external dep changes
        'ci',       // CI/CD config changes
        'deps',     // dependency updates (Dependabot)
        'revert',   // revert a previous commit
      ],
    ],
    // subject-case: allow sentence-case and lower-case
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    // body-max-line-length: allow longer lines in body
    'body-max-line-length': [1, 'always', 120],
  },
};
