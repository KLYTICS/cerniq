// Vitest workspace — picks up tests across packages, apps, and the
// cross-package test directory. Lets a single `pnpm vitest run` exercise
// SDK + API + cross-boundary parity together.
//
// Per ADR-0008, the SDK and API maintain independent JWT implementations
// to keep `jose` off the verify hot path. `tests/cross-package/` exists
// to catch silent divergence between the two; this workspace file makes
// those tests run as part of the default test command.

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'apps/api',
  'apps/dashboard',
  'tests/cross-package',
]);
