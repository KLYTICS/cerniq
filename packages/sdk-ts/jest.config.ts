import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: false }],
  },
  // pnpm hoists @noble under .pnpm/<scope>+<pkg>@<ver>/. The @noble packages
  // are ESM-only so they must pass through ts-jest at test time.
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/)?(@noble|@aegis)([+/]|$))',
  ],
  // ESM-style relative imports (`./foo.js`) must resolve to the `.ts` source
  // when ts-jest emits CJS.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  testEnvironment: 'node',
  clearMocks: true,
};

export default config;
