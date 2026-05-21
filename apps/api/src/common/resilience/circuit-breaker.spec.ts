import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
  wrapWithBreaker,
} from './circuit-breaker';

describe('CircuitOpenError.catalogKey', () => {
  it('exposes a static catalogKey that survives minification (F-06)', () => {
    expect(CircuitOpenError.catalogKey).toBe('CircuitOpenError');
    // Simulate a minifier rename of the class to a single letter.
    const err = new CircuitOpenError('demo');
    Object.defineProperty(err.constructor, 'name', { value: 'a' });
    expect((err.constructor as typeof CircuitOpenError).catalogKey).toBe('CircuitOpenError');
  });
});

describe('CircuitBreaker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker({
      name: 'test.start',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
    });
    expect(cb.state).toBe('CLOSED');
  });

  it('keeps CLOSED on 4 failures (default threshold 5)', async () => {
    const cb = new CircuitBreaker({
      name: 'test.below-threshold',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
    });
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    for (let i = 0; i < 4; i += 1) {
      await expect(cb.exec(failing)).rejects.toThrow('boom');
    }
    expect(cb.state).toBe('CLOSED');
    expect(failing).toHaveBeenCalledTimes(4);
  });

  it('trips to OPEN on the 5th consecutive failure and fast-fails', async () => {
    const cb = new CircuitBreaker({
      name: 'test.trip',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
    });
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    for (let i = 0; i < 5; i += 1) {
      await expect(cb.exec(failing)).rejects.toThrow('boom');
    }
    expect(cb.state).toBe('OPEN');
    expect(failing).toHaveBeenCalledTimes(5);

    // Subsequent call must short-circuit without invoking fn.
    await expect(cb.exec(failing)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(failing).toHaveBeenCalledTimes(5); // unchanged
  });

  it('respects a custom failureThreshold', async () => {
    const cb = new CircuitBreaker({
      name: 'test.custom-threshold',
      failureThreshold: 2,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
    });
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(cb.exec(failing)).rejects.toThrow('boom');
    expect(cb.state).toBe('CLOSED');
    await expect(cb.exec(failing)).rejects.toThrow('boom');
    expect(cb.state).toBe('OPEN');
  });

  it('transitions OPEN → HALF_OPEN after resetTimeoutMs and invokes the probe', async () => {
    const cb = new CircuitBreaker({
      name: 'test.half-open',
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
    });
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(cb.exec(failing)).rejects.toThrow('boom');
    expect(cb.state).toBe('OPEN');

    // Still OPEN before the window elapses.
    jest.advanceTimersByTime(29_999);
    await expect(cb.exec(failing)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(cb.state).toBe('OPEN');

    // After resetTimeoutMs the next call probes.
    jest.advanceTimersByTime(2);
    const probe = jest.fn().mockResolvedValue('ok');
    await expect(cb.exec(probe)).resolves.toBe('ok');
    expect(probe).toHaveBeenCalledTimes(1);
    // Probe success → CLOSED.
    expect(cb.state).toBe('CLOSED');
  });

  it('HALF_OPEN probe success transitions to CLOSED and resets failures', async () => {
    const cb = new CircuitBreaker({
      name: 'test.probe-success',
      failureThreshold: 2,
      resetTimeoutMs: 1_000,
      halfOpenMaxCalls: 1,
    });
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(cb.exec(failing)).rejects.toThrow();
    await expect(cb.exec(failing)).rejects.toThrow();
    expect(cb.state).toBe('OPEN');

    jest.advanceTimersByTime(1_000);
    const ok = jest.fn().mockResolvedValue('healthy');
    await expect(cb.exec(ok)).resolves.toBe('healthy');
    expect(cb.state).toBe('CLOSED');

    // Counter reset: a single failure should NOT trip immediately.
    await expect(cb.exec(failing)).rejects.toThrow();
    expect(cb.state).toBe('CLOSED');
  });

  it('HALF_OPEN probe failure re-opens the breaker and resets the trip clock', async () => {
    const cb = new CircuitBreaker({
      name: 'test.probe-failure',
      failureThreshold: 1,
      resetTimeoutMs: 5_000,
      halfOpenMaxCalls: 1,
    });
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(cb.exec(failing)).rejects.toThrow();
    expect(cb.state).toBe('OPEN');

    // Enter HALF_OPEN.
    jest.advanceTimersByTime(5_000);
    await expect(cb.exec(failing)).rejects.toThrow('boom');
    expect(cb.state).toBe('OPEN');

    // Trip clock was reset — still OPEN at +4_999 ms.
    jest.advanceTimersByTime(4_999);
    await expect(cb.exec(failing)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(cb.state).toBe('OPEN');
  });

  it('HALF_OPEN with halfOpenMaxCalls=1 rejects concurrent probe overflow', async () => {
    const cb = new CircuitBreaker({
      name: 'test.half-open-overflow',
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      halfOpenMaxCalls: 1,
    });
    await expect(cb.exec(() => Promise.reject(new Error('boom')))).rejects.toThrow();
    jest.advanceTimersByTime(1_000);

    // First probe — kept pending, never resolves until we say so.
    let release!: () => void;
    const gated = new Promise<string>((resolve) => {
      release = () => { resolve('ok'); };
    });
    const probe1 = cb.exec(() => gated);

    // Second concurrent probe — must be rejected without invoking fn.
    const overflowFn = jest.fn().mockResolvedValue('shouldnt-run');
    await expect(cb.exec(overflowFn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(overflowFn).not.toHaveBeenCalled();

    // Resolve the first probe — should land us in CLOSED.
    release();
    await expect(probe1).resolves.toBe('ok');
    expect(cb.state).toBe('CLOSED');
  });

  it('fires onStateChange with the correct (from, to) tuple on each transition', async () => {
    const transitions: [CircuitState, CircuitState][] = [];
    const cb = new CircuitBreaker({
      name: 'test.hook',
      failureThreshold: 1,
      resetTimeoutMs: 1_000,
      halfOpenMaxCalls: 1,
      onStateChange: (from, to) => transitions.push([from, to]),
    });

    // CLOSED → OPEN
    await expect(cb.exec(() => Promise.reject(new Error('x')))).rejects.toThrow();
    // OPEN → HALF_OPEN → CLOSED
    jest.advanceTimersByTime(1_000);
    await expect(cb.exec(() => Promise.resolve('ok'))).resolves.toBe('ok');

    expect(transitions).toEqual([
      ['CLOSED', 'OPEN'],
      ['OPEN', 'HALF_OPEN'],
      ['HALF_OPEN', 'CLOSED'],
    ]);
  });

  it('does not invoke fn when fast-failing in OPEN state', async () => {
    const cb = new CircuitBreaker({
      name: 'test.no-invoke',
      failureThreshold: 1,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 1,
    });
    await expect(cb.exec(() => Promise.reject(new Error('x')))).rejects.toThrow();
    const fn = jest.fn().mockResolvedValue('nope');
    await expect(cb.exec(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('wrapWithBreaker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('wires metrics sink on every transition + records trips once per OPEN edge', async () => {
    const setState = jest.fn();
    const recordTrip = jest.fn();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValue('ok');

    const { breaker, call } = wrapWithBreaker('demo.svc', () => fn(), {
      failureThreshold: 2,
      resetTimeoutMs: 1_000,
      halfOpenMaxCalls: 1,
      metrics: { setState, recordTrip },
    });

    await expect(call()).rejects.toThrow();
    await expect(call()).rejects.toThrow();
    expect(breaker.state).toBe('OPEN');
    expect(setState).toHaveBeenCalledWith('demo.svc', 2); // OPEN
    expect(recordTrip).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1_000);
    await expect(call()).resolves.toBe('ok');
    expect(breaker.state).toBe('CLOSED');

    expect(setState.mock.calls).toEqual([
      ['demo.svc', 2], // OPEN
      ['demo.svc', 1], // HALF_OPEN
      ['demo.svc', 0], // CLOSED
    ]);
    expect(recordTrip).toHaveBeenCalledTimes(1);
  });
});
