import { trace, SpanStatusCode } from '@opentelemetry/api';

import { setActiveSpanAttributes, withSpan } from './spans';

describe('withSpan', () => {
  let getTracerSpy: jest.SpyInstance;
  let span: {
    setAttribute: jest.Mock;
    setStatus: jest.Mock;
    recordException: jest.Mock;
    end: jest.Mock;
  };

  beforeEach(() => {
    span = {
      setAttribute: jest.fn(),
      setStatus: jest.fn(),
      recordException: jest.fn(),
      end: jest.fn(),
    };
    getTracerSpy = jest.spyOn(trace, 'getTracer').mockReturnValue({
      startActiveSpan: ((_name: string, _opts: unknown, fn: (s: unknown) => unknown) =>
        fn(span)) as never,
    } as never);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  it('runs fn and ends the span on success', async () => {
    const result = await withSpan('aegis.test.ok', async () => 'value', {
      'agent.id': 'agt_1',
      'policy.id': 'pol_2',
    });
    expect(result).toBe('value');
    expect(span.setAttribute).toHaveBeenCalledWith('agent.id', 'agt_1');
    expect(span.setAttribute).toHaveBeenCalledWith('policy.id', 'pol_2');
    expect(span.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.recordException).not.toHaveBeenCalled();
  });

  it('skips undefined attribute values without setting them on the span', async () => {
    await withSpan('aegis.test.ok', async () => undefined, {
      'agent.id': 'agt_1',
      'policy.id': undefined,
    });
    expect(span.setAttribute).toHaveBeenCalledWith('agent.id', 'agt_1');
    expect(span.setAttribute).not.toHaveBeenCalledWith('policy.id', expect.anything());
  });

  it('marks ERROR, records the exception, and re-throws on a thrown fn', async () => {
    const boom = new Error('boom');
    boom.name = 'CustomError';
    await expect(
      withSpan('aegis.test.fail', async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(span.recordException).toHaveBeenCalledWith(boom);
    expect(span.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'boom',
    });
    expect(span.setAttribute).toHaveBeenCalledWith('error.kind', 'CustomError');
    expect(span.end).toHaveBeenCalledTimes(1);
  });
});

describe('setActiveSpanAttributes', () => {
  let getActiveSpanSpy: jest.SpyInstance;

  afterEach(() => {
    getActiveSpanSpy?.mockRestore();
  });

  it('is a no-op when no active span', () => {
    getActiveSpanSpy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
    expect(() => { setActiveSpanAttributes({ 'agent.id': 'agt_1' }); }).not.toThrow();
  });

  it('sets attributes on the active span and skips undefined', () => {
    const span = { setAttribute: jest.fn() } as unknown as ReturnType<typeof trace.getActiveSpan>;
    getActiveSpanSpy = jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span);
    setActiveSpanAttributes({ 'agent.id': 'agt_1', 'policy.id': undefined, 'decision': 'APPROVED' });
    expect(span!.setAttribute).toHaveBeenCalledWith('agent.id', 'agt_1');
    expect(span!.setAttribute).toHaveBeenCalledWith('decision', 'APPROVED');
    expect(span!.setAttribute).not.toHaveBeenCalledWith('policy.id', expect.anything());
  });
});
