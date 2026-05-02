module.exports = {
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
        'security',
      ],
    ],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case']],
    'subject-max-length': [2, 'always', 100],
  },
};
