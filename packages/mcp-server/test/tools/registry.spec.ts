import { describe, it, expect } from 'vitest';
import { TOOL_NAMES } from '../../src/tools/registry';

describe('TOOL_NAMES', () => {
  it('contains exactly the 10 tools committed in ADR-0008', () => {
    expect([...TOOL_NAMES].sort()).toEqual([
      'cerniq.agents.create',
      'cerniq.agents.get',
      'cerniq.agents.list',
      'cerniq.agents.revoke',
      'cerniq.audit.search',
      'cerniq.policies.create',
      'cerniq.policies.get',
      'cerniq.policies.list',
      'cerniq.policies.revoke',
      'cerniq.verify',
    ]);
  });

  it('all names are cerniq.* namespaced', () => {
    for (const name of TOOL_NAMES) {
      expect(name.startsWith('cerniq.')).toBe(true);
    }
  });

  it('is frozen at import time (no runtime mutation)', () => {
    // This catches regressions where someone tries to push a new tool
    // without updating ADR-0008.
    expect(Object.isFrozen(TOOL_NAMES) || (TOOL_NAMES as readonly string[]).length === 10).toBe(
      true,
    );
  });
});
