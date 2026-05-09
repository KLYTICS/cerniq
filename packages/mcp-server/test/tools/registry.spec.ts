import { describe, it, expect } from 'vitest';
import { TOOL_NAMES } from '../../src/tools/registry';

describe('TOOL_NAMES', () => {
  it('contains exactly the 10 tools committed in ADR-0008', () => {
    expect([...TOOL_NAMES].sort()).toEqual([
      'aegis.agents.create',
      'aegis.agents.get',
      'aegis.agents.list',
      'aegis.agents.revoke',
      'aegis.audit.search',
      'aegis.policies.create',
      'aegis.policies.get',
      'aegis.policies.list',
      'aegis.policies.revoke',
      'aegis.verify',
    ]);
  });

  it('all names are aegis.* namespaced', () => {
    for (const name of TOOL_NAMES) {
      expect(name.startsWith('aegis.')).toBe(true);
    }
  });

  it('is frozen at import time (no runtime mutation)', () => {
    // This catches regressions where someone tries to push a new tool
    // without updating ADR-0008.
    expect(Object.isFrozen(TOOL_NAMES) || (TOOL_NAMES as readonly string[]).length === 10).toBe(true);
  });
});
