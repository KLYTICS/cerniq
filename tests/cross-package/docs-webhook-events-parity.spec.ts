import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Import from source path, not package alias — @okoro/types points to dist/
// which is not built at parity-test time. Matches the pattern used by
// existing parity specs (e.g. denial-reason-parity.spec.ts).
import { WEBHOOK_EVENT } from '../../packages/types/src/constants';

// Cross-package parity gate for @okoro/docs <WebhookEventCatalog/>.
//
// Why: relying parties subscribe to event names verbatim. If docs ever
// shows an event that doesn't exist (or hides one that does), integrators
// build dead-letter handlers for phantom events or miss legitimate ones.
// The catalog component must consume the wire constant directly.

const COMPONENT_PATH = join(
  __dirname,
  '..',
  '..',
  'apps',
  'docs',
  'components',
  'live',
  'webhook-event-catalog.tsx',
);

describe('docs ↔ @okoro/types webhook event parity', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');

  it('imports WEBHOOK_EVENT from @okoro/types', () => {
    expect(source).toMatch(/from\s+['"]@okoro\/types['"]/);
    expect(source).toContain('WEBHOOK_EVENT');
  });

  it('does not redeclare WEBHOOK_EVENT locally', () => {
    const inlinePattern = /(?:const|let|var)\s+WEBHOOK_EVENT\s*=/;
    expect(inlinePattern.test(source)).toBe(false);
  });

  it('has EVENT_COPY entries for every event in the wire constant', () => {
    for (const event of Object.values(WEBHOOK_EVENT)) {
      expect(source).toContain(event);
    }
  });

  it('wire constant exposes at least the five Phase-1 events', () => {
    expect(Object.keys(WEBHOOK_EVENT).length).toBeGreaterThanOrEqual(5);
  });
});
