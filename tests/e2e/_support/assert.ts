/**
 * Domain-specific assertion helpers. Vitest's `expect` is fine for
 * primitives; these give us readable failures for the CERNIQ-specific
 * shapes that recur across many tests.
 */

import { expect } from 'vitest';
import type { DenialReason, VerifyResult } from '@cerniq/sdk';

export function assertVerifyApproved(result: VerifyResult, ctx: { agentId?: string } = {}): void {
  expect(
    result.valid,
    `expected verify approved, got denied with reason=${String(result.denialReason)}`,
  ).toBe(true);
  expect(result.denialReason).toBeNull();
  if (ctx.agentId) expect(result.agentId).toBe(ctx.agentId);
  expect(result.trustScore).toBeTypeOf('number');
}

export function assertVerifyDenied(result: VerifyResult, expected: DenialReason): void {
  expect(result.valid, `expected denial=${expected}, but verify was approved`).toBe(false);
  expect(
    result.denialReason,
    `expected denial=${expected}, got ${String(result.denialReason)}`,
  ).toBe(expected);
}

/**
 * Asserts an audit event matching the predicate exists. Use a poll
 * because audit writes may be asynchronous on the API side.
 */
export async function assertAuditEvent(
  fetchEvents: () => Promise<{
    events: Array<{ eventId: string; decision?: string; decisionReason?: string | null }>;
  }>,
  predicate: (e: { decision?: string; decisionReason?: string | null }) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5_000);
  let lastSeen: unknown = undefined;
  while (Date.now() < deadline) {
    const { events } = await fetchEvents();
    lastSeen = events;
    if (events.some(predicate)) return;
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 200));
  }
  throw new Error(
    `audit event matching predicate not found within ${opts.timeoutMs ?? 5_000}ms. last events: ${JSON.stringify(
      lastSeen,
    ).slice(0, 800)}`,
  );
}
