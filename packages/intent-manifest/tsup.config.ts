import { defineConfig } from 'tsup';

// NOTE: dts emit handled by `tsc --emitDeclarationOnly` in `build:dts`,
// mirroring the @aegis/audit-verifier escape hatch (tsup worker DTS
// crashes on packages that import @noble/* — Round 16/17 deferred debt).
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
});
