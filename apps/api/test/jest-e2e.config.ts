import type { Config } from 'jest';

const config: Config = {
  rootDir: '..',
  testRegex: '.*\\.e2e[.-]spec\\.ts$',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: false }],
  },
  // Mirror unit-test config: allow @noble (ESM-only) and @aegis workspace
  // packages through ts-jest. Without this, `@noble/ed25519` blows up at
  // import time under Jest's CJS runtime.
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/)?(@noble|@aegis)([+/]|$))',
  ],
  // Production source uses ESM-style `./foo.js` imports of sibling .ts
  // files. Under ts-jest's CJS transform we have to map `.js` back to the
  // `.ts` source so resolution succeeds.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30_000,
};

export default config;
