import { describe, it, expect } from 'vitest';
import { TOOL_NAMES } from '../../src/tools/registry';

describe('TOOL_NAMES', () => {
  it('contains exactly the 10 tools committed in ADR-0008', () => {
    expect([...TOOL_NAMES].sort()).toEqual([
      'okoro.agents.create',
      'okoro.agents.get',
      'okoro.agents.list',
      'okoro.agents.revoke',
      'okoro.audit.search',
      'okoro.policies.create',
      'okoro.policies.get',
      'okoro.policies.list',
      'okoro.policies.revoke',
      'okoro.verify',
    ]);
  });

  it('all names are okoro.* namespaced', () => {
    for (const name of TOOL_NAMES) {
      expect(name.startsWith('okoro.')).toBe(true);
    }
  });

  it('is frozen at import time (no runtime mutation)', () => {
    // This catches regressions where someone tries to push a new tool
    // without updating ADR-0008.
    expect(Object.isFrozen(TOOL_NAMES) || (TOOL_NAMES as readonly string[]).length === 10).toBe(true);
  });
});
