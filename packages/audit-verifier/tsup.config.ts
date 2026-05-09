import { defineConfig } from 'tsup';

// NOTE: dts is intentionally disabled here. tsup's worker-based DTS emit
// crashes on this package (Round 16/17 deferred debt). We use the documented
// escape hatch: emit .d.ts via `tsc --emitDeclarationOnly` in `build:dts`,
// chained from the `build` script in package.json.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
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
