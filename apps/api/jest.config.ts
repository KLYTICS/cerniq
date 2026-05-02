import type { Config } from 'jest';

const config: Config = {
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/test/'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: false }],
  },
  // pnpm hoists ESM packages under node_modules/.pnpm/<scope>+<pkg>@<ver>/...
  // Both shapes must be allowed through ts-jest, so the negative-lookahead
  // covers the .pnpm subdir as well as the top-level @noble path.
  transformIgnorePatterns: [
    '/node_modules/(?!(\\.pnpm/)?(@noble|@aegis)([+/]|$))',
  ],
  // ESM-style imports (`./foo.js`) must resolve to the `.ts` source under
  // ts-jest's CJS transform. Without this mapper, every relative `.js`
  // import in source code fails at test time.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts', '!src/**/*.dto.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  clearMocks: true,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};

export default config;
