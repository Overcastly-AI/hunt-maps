/**
 * Conventional Commits, enforced by the `commit-msg` hook.
 *
 * This is not a style preference. `semantic-release` derives the version, the
 * CHANGELOG and the published image tags from these messages — a malformed
 * subject does not fail loudly, it silently produces no release or the wrong
 * bump. The types below are exactly the ones `.releaserc.json` knows how to
 * classify; adding one here without adding it there means commits that look
 * fine and never appear in a changelog.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'refactor',
        'docs',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // The repo's own commit style runs long in the body because the *why*
    // matters more than the diff. Only the subject is constrained.
    'body-max-line-length': [0, 'always'],
    'footer-max-line-length': [0, 'always'],
    'subject-case': [2, 'never', ['pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
