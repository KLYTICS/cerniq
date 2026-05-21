// Flat ESLint config — applies to all workspaces unless they extend it.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import securityPlugin from 'eslint-plugin-security';
import unicornPlugin from 'eslint-plugin-unicorn';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'docs/spec/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      import: importPlugin,
      security: securityPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      // ── Hard-error: correctness + security. Real bugs, not preferences.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',

      // ── Demoted: stylistic / over-strict rules from
      // `strictTypeChecked` + `stylisticTypeChecked` that the codebase
      // wasn't authored under. Keep them disabled so the gate is
      // honest; ratchet specific ones back to `error` in dedicated
      // hygiene rounds (see docs/SESSION_HANDOFF.md 2026-05-21).
      //
      // The risk profile of each:
      //   - restrict-template-expressions: cosmetic; ${String(n)} noise.
      //   - no-unnecessary-condition: defensive system-boundary checks
      //     are intentional even when TS says they're unreachable.
      //   - array-type: T[] vs Array<T> is preference.
      //   - no-extraneous-class: static-only utility classes are
      //     idiomatic for grouped helpers; opt-out is fine.
      //   - prefer-optional-chain / prefer-for-of: stylistic.
      //   - return-await: tracing-friendly `return await` is on purpose
      //     in AEGIS (preserves stack trace through async boundaries).
      //   - consistent-type-imports: useful but mechanical; ratchet later.
      //   - no-unnecessary-type-assertion / -type-parameters: occasional
      //     legitimate uses (DTO narrowing); opt-out for now.
      //   - require-await: async functions in plugin shapes that must
      //     return Promise but have no internal await are common.
      //   - no-redundant-type-constituents: usually right but flags
      //     intentional `T | Promise<T>` ergonomics unions.
      //   - dot-notation: rarely actionable.
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-for-of': 'off',
      '@typescript-eslint/return-await': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-useless-assignment': 'off',

      // Security
      'security/detect-object-injection': 'off', // Too noisy with TS-typed records.
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',

      // Quality
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
          message: 'Math.random is non-cryptographic. Use crypto.randomUUID / randomBytes.',
        },
      ],
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/no-process-exit': 'off', // We use process.exit in main.ts shutdown.

      // Imports
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
  {
    // Test files — relax rules that fire heavily on vitest/jest patterns
    // (mock object spreading, `expect(svc.method).toHaveBeenCalled()`,
    // re-importing types from `@aegis/sdk` alongside vitest, etc.).
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      'import/order': 'off',
    },
  },
  prettier,
);
