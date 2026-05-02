/**
 * Eventual-consistency helpers. The audit log, BATE score, and webhook
 * delivery queue are async writes — tests poll until the expected state
 * appears or the budget runs out.
 */

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onAttempt?: (attempt: number) => void;
}

/**
 * Repeatedly invoke `probe` until it returns a truthy value (or matches the
 * optional predicate). Throws if the budget is exhausted.
 */
export async function pollUntil<T>(
  probe: () => Promise<T>,
  predicate: (val: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  const timeout = opts.timeoutMs ?? 5_000;
  const interval = opts.intervalMs ?? 150;
  const deadline = Date.now() + timeout;
  let last: T | undefined;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    opts.onAttempt?.(attempt);
    last = await probe();
    if (predicate(last)) return last;
    await sleep(interval);
  }
  throw new Error(
    `pollUntil exceeded ${timeout}ms (${attempt} attempts). last value: ${JSON.stringify(last).slice(0, 400)}`,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
