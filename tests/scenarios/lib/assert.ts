// Minimal Bloomberg-density assertion helper. No vitest dep — the
// runner is standalone. Each expect() call records into the scenario's
// assertion log; failures throw to short-circuit but the log is still
// captured by the runner's try/catch.

export interface Assertion {
  name: string;
  pass: boolean;
  detail?: string;
}

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export class AssertCtx {
  public log: Assertion[] = [];

  private record(name: string, pass: boolean, detail?: string): void {
    this.log.push({ name, pass, detail });
    if (!pass) throw new AssertionError(`${name} — ${detail ?? 'assertion failed'}`);
  }

  expect<T>(actual: T, name: string) {
    return {
      toBe: (expected: T): void => {
        const pass = actual === expected;
        this.record(name, pass, pass ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      },
      toEqual: (expected: unknown): void => {
        const pass = JSON.stringify(actual) === JSON.stringify(expected);
        this.record(name, pass, pass ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      },
      toBeTruthy: (): void => {
        const pass = Boolean(actual);
        this.record(name, pass, pass ? undefined : `expected truthy, got ${JSON.stringify(actual)}`);
      },
      toBeFalsy: (): void => {
        const pass = !actual;
        this.record(name, pass, pass ? undefined : `expected falsy, got ${JSON.stringify(actual)}`);
      },
      toContain: (needle: unknown): void => {
        const pass = Array.isArray(actual) ? actual.includes(needle as never) :
                     typeof actual === 'string' ? actual.includes(needle as string) :
                     false;
        this.record(name, pass, pass ? undefined : `expected ${JSON.stringify(actual)} to contain ${JSON.stringify(needle)}`);
      },
      toBeLessThan: (limit: number): void => {
        const pass = typeof actual === 'number' && actual < limit;
        this.record(name, pass, pass ? undefined : `expected < ${limit}, got ${actual}`);
      },
      toBeGreaterThan: (limit: number): void => {
        const pass = typeof actual === 'number' && actual > limit;
        this.record(name, pass, pass ? undefined : `expected > ${limit}, got ${actual}`);
      },
      toBeGreaterThanOrEqual: (limit: number): void => {
        const pass = typeof actual === 'number' && actual >= limit;
        this.record(name, pass, pass ? undefined : `expected >= ${limit}, got ${actual}`);
      },
      toBeOneOf: (allowed: readonly T[]): void => {
        const pass = allowed.includes(actual);
        this.record(name, pass, pass ? undefined : `expected one of ${JSON.stringify(allowed)}, got ${JSON.stringify(actual)}`);
      },
    };
  }
}
