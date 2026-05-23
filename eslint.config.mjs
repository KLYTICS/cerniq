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
      '**/.source/**', // Fumadocs build artifact (apps/docs).
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
      // Strictness — make sloppy code fail fast.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `disallowTypeAnnotations: false` lets us keep `typeof import('mod').X`
      // annotations on deferred-load patterns (OpenTelemetry, etc.).
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],

      // restrict-template-expressions: strict-type-checked enables this with
      // very narrow defaults that flag every `${number}`, `${boolean}`,
      // `${error.code}` etc. Logging and error messages need these — allow them.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowBoolean: true,
          allowNullish: true,
          allowAny: false,
          allowRegExp: true,
        },
      ],

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
    // Plain JS / config files — strip type-aware rules since they have no TS program.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // apps/api third-party SDK adapters — Stripe, Auth0, Clerk, WorkOS, KMS.
    // These SDKs return `any` for many fields (Stripe `Subscription.items`,
    // Auth0 management responses, etc.). The `no-unsafe-*` errors here are
    // library shape, not code quality. Validation happens at the use-site via
    // Zod schemas in the calling services.
    files: [
      'apps/api/src/modules/billing/**/*.ts',
      'apps/api/src/modules/auth0/**/*.ts',
      'apps/api/src/modules/idp-*/**/*.ts',
      'apps/api/src/modules/kms/**/*.ts',
      'apps/api/src/modules/mcp/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // apps/api — NestJS reality.
    // NestJS controllers/services rely on framework conventions that ESLint reads as
    // bugs: async lifecycle hooks with no `await` (require-await), modules expressed
    // as decorator-only classes (no-extraneous-class), and Jest matchers that
    // appear to call unbound methods (unbound-method in specs). Disabling here
    // keeps the strict-type-checked spirit while accepting framework idioms.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off', // Defensive checks at runtime/user-input boundaries are common.
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
    },
  },
  {
    // mcp-server and cli — both call SDK methods that don't currently exist on
    // the @cerniq/sdk AgentClient surface (e.g. `cerniq.agents.create`, `.list`).
    // The unsafe-* + no-deprecated errors are cascades from this API drift.
    // TODO(api-drift): align SDK + cli + mcp-server, then remove this block.
    files: ['packages/mcp-server/src/**/*.ts', 'packages/cli/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
  {
    // apps/docs — Fumadocs + Next.js documentation site.
    // Similar boundary code to dashboard plus generator scripts that read
    // untrusted OpenAPI/SDK shapes; relaxations match dashboard.
    files: ['apps/docs/**/*.{ts,tsx,mjs}'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-undef': 'off', // .mjs generator scripts use Node globals without ambient types.
      'no-console': 'off', // Generator scripts log progress to stdout intentionally.
    },
  },
  {
    // apps/dashboard — Next.js + browser + server-action boundary code.
    // FormData, navigator, Auth0 session stubs, fetch responses all introduce
    // values whose types TS narrows but runtime can defy. Defensive checks here
    // are intentional UX guards, not dead code.
    files: ['apps/dashboard/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off', // Server action / session helper stubs.
      '@typescript-eslint/no-base-to-string': 'off', // FormData.get() return type.
      '@typescript-eslint/no-invalid-void-type': 'off', // RTK-style generics use `void`.
      '@typescript-eslint/no-misused-promises': 'off', // React onClick={asyncHandler} is fine.
      '@typescript-eslint/no-deprecated': 'off', // navigator.platform / execCommand fallbacks for older browsers.
    },
  },
  {
    // verifier-rp adapters — framework boundary code. Express/Fastify/Hono let
    // JS callers pass anything; the defensive guards here validate runtime values
    // that TS cannot trust, even though the public TS signature looks well-typed.
    files: ['packages/verifier-rp/src/adapters/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-misused-promises': 'off', // Express RequestHandler accepts async, but TS flags it.
      '@typescript-eslint/require-await': 'off', // Fastify plugins must be async per their signature.
      '@typescript-eslint/no-redundant-type-constituents': 'off', // `Promise<X> | X` is the framework's own pattern.
    },
  },
  {
    // Test files — relax rules that conflict with Jest patterns and test ergonomics.
    files: ['**/*.spec.ts', '**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off', // Jest expect(obj.method) idiom.
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off', // Common in jest mock signatures.
      'no-restricted-syntax': 'off', // Math.random is OK in tests.
    },
  },
  prettier,
);
