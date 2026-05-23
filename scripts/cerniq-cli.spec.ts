/**
 * cerniq-cli.spec.ts — command parsing tests (no network).
 *
 * We import `buildCli` and `DENIAL_DESCRIPTIONS` directly. Subcommand action
 * handlers do real I/O, so we don't invoke them; we only check that
 * commander parses the flag set and rejects malformed input as expected.
 */

import { describe, it, expect } from 'vitest';
import type { Command, Option } from 'commander';

import { buildCli, DENIAL_DESCRIPTIONS } from './cerniq-cli.js';

type Cmd = Command;
type Opt = Option;

function parseSafe(argv: string[]): { ok: true; cmdName: string } | { ok: false; code: number } {
  const program = buildCli();
  // commander writes to process.stderr on errors; suppress.
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });
  try {
    // We `parse` synchronously without running actions — actions are async
    // but commander queues them; using parse (not parseAsync) keeps tests
    // network-free as long as we don't reach an action that needs network.
    program.parse(['node', 'cerniq', ...argv], { from: 'node' });
    return { ok: true, cmdName: program.args.join(' ') };
  } catch (err) {
    const e = err as { exitCode?: number };
    return { ok: false, code: e.exitCode ?? 1 };
  }
}

describe('buildCli — command surface', () => {
  it('exposes top-level subcommands', () => {
    const program = buildCli();
    const names = program.commands.map((c: Cmd) => c.name());
    expect(names).toEqual(
      expect.arrayContaining(['register', 'agent', 'policy', 'verify', 'audit', 'trust', 'health']),
    );
  });

  it('agent has register/list/revoke/status', () => {
    const program = buildCli();
    const agent = program.commands.find((c: Cmd) => c.name() === 'agent');
    expect(agent).toBeDefined();
    const sub = agent!.commands.map((c: Cmd) => c.name());
    expect(sub).toEqual(expect.arrayContaining(['register', 'list', 'revoke', 'status']));
  });

  it('policy has create/list/revoke', () => {
    const program = buildCli();
    const policy = program.commands.find((c: Cmd) => c.name() === 'policy');
    const sub = policy!.commands.map((c: Cmd) => c.name());
    expect(sub).toEqual(expect.arrayContaining(['create', 'list', 'revoke']));
  });

  it('audit has tail with --follow flag', () => {
    const program = buildCli();
    const audit = program.commands.find((c: Cmd) => c.name() === 'audit');
    const tail = audit!.commands.find((c: Cmd) => c.name() === 'tail');
    expect(tail).toBeDefined();
    const flags = tail!.options.map((o: Opt) => o.long);
    expect(flags).toEqual(expect.arrayContaining(['--agent', '--since', '--follow']));
  });

  it('global flags --api-base, --api-key, --json exist', () => {
    const program = buildCli();
    const longs = program.options.map((o: Opt) => o.long);
    expect(longs).toEqual(expect.arrayContaining(['--api-base', '--api-key', '--json']));
  });

  it('register requires --email', () => {
    // Missing --email triggers commander's "missing required option" path.
    const result = parseSafe(['register']);
    expect(result.ok).toBe(false);
  });

  it('policy create requires --agent, --scope, --max-per-tx', () => {
    const result = parseSafe(['policy', 'create']);
    expect(result.ok).toBe(false);
  });

  it('verify requires --agent, --policy, --action', () => {
    const result = parseSafe(['verify']);
    expect(result.ok).toBe(false);
  });

  it('agent revoke requires positional <agentId>', () => {
    const result = parseSafe(['agent', 'revoke']);
    expect(result.ok).toBe(false);
  });

  it('trust score requires positional <agentId>', () => {
    const result = parseSafe(['trust', 'score']);
    expect(result.ok).toBe(false);
  });

  it('--help on root exits cleanly', () => {
    const result = parseSafe(['--help']);
    // commander exitOverride throws CommanderError with exitCode=0 for --help
    expect(result.ok === false && result.code === 0).toBe(true);
  });
});

describe('DENIAL_DESCRIPTIONS', () => {
  it('covers every denial reason from CLAUDE.md precedence', () => {
    const required = [
      'AGENT_NOT_FOUND',
      'AGENT_REVOKED',
      'INVALID_SIGNATURE',
      'POLICY_REVOKED',
      'POLICY_EXPIRED',
      'SCOPE_NOT_GRANTED',
      'SPEND_LIMIT_EXCEEDED',
      'TRUST_SCORE_TOO_LOW',
      'ANOMALY_FLAGGED',
    ];
    for (const reason of required) {
      expect(DENIAL_DESCRIPTIONS[reason]).toBeDefined();
      expect(DENIAL_DESCRIPTIONS[reason]!.length).toBeGreaterThan(10);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(DENIAL_DESCRIPTIONS)).toBe(true);
  });
});
