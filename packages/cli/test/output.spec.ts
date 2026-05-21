import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emit, emitRecord, setOutputMode, getOutputMode } from '../src/output.js';

describe('output mode switching', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let buffer: string;

  beforeEach(() => {
    buffer = '';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      buffer += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    setOutputMode('table');
  });

  it('defaults to table mode', () => {
    expect(getOutputMode()).toBe('table');
  });

  it('emit() writes table rows in default mode', () => {
    emit({ items: [{ id: 'a' }] }, [{ id: 'a', name: 'x' }]);
    expect(buffer).toContain('id');
    expect(buffer).toContain('name');
    expect(buffer).toContain('a');
    expect(buffer).toContain('x');
  });

  it('emit() writes the payload JSON in json mode', () => {
    setOutputMode('json');
    const payload = { items: [{ id: 'a' }], nextCursor: 'cur_1' };
    emit(payload, [{ id: 'a' }]);
    const parsed = JSON.parse(buffer.trim());
    expect(parsed).toEqual(payload);
  });

  it('emitRecord() pretty-prints in table mode and JSONs in json mode', () => {
    setOutputMode('table');
    emitRecord({ agentId: 'agt_1', status: 'ACTIVE' });
    expect(buffer).toContain('agentId');
    expect(buffer).toContain('agt_1');

    buffer = '';
    setOutputMode('json');
    emitRecord({ agentId: 'agt_1', status: 'ACTIVE' });
    expect(JSON.parse(buffer.trim())).toEqual({ agentId: 'agt_1', status: 'ACTIVE' });
  });
});
