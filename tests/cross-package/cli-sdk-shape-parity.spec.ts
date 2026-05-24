// Cross-package parity — CLI ↔ SDK contract shape.
//
// OD-024 (DECIDED 2026-05-24) chose Option A: extend `@cerniq/sdk` so the
// CLI's existing verb shapes resolve against the typed SDK surface, rather
// than refactoring the CLI to a narrower SDK. This spec is the gate that
// catches future drift between what the CLI calls and what the SDK exposes
// — before it lands as a red CI `Typecheck` step.
//
// The original drift (commit 4403bba, surfaced 2026-05-24 on PR #55) was
// hidden for two days because `pnpm doctor:full` only typechecks 3 of 17
// workspaces and skips the CLI. Method-presence checks on a live `Cerniq`
// instance would have failed instantly. That's what this spec encodes.
//
// Tightness chosen: **loose** — runtime presence + return-type assertions.
// Parameter shapes intentionally not locked so SDK input ergonomics can
// evolve without test churn. Structural drift (a CLI-called method
// disappearing) trips immediately.

import { describe, expect, expectTypeOf, it } from 'vitest';

import { Cerniq } from '../../packages/sdk-ts/src/index';
import type {
  AgentRecord,
  ListAgentsResponse,
  PolicyListItem,
  PolicyListResponse,
  PolicyRecord,
} from '../../packages/sdk-ts/src/types';

const cerniq = new Cerniq({ apiKey: 'cerniq_sk_parity_dummy' });

describe('CLI ↔ SDK contract parity (OD-024)', () => {
  describe('AgentClient — methods the CLI calls', () => {
    it('exposes register, create, list, get, revoke', () => {
      expect(typeof cerniq.agents.register).toBe('function');
      expect(typeof cerniq.agents.create).toBe('function');
      expect(typeof cerniq.agents.list).toBe('function');
      expect(typeof cerniq.agents.get).toBe('function');
      expect(typeof cerniq.agents.revoke).toBe('function');
    });

    it('create resolves to AgentRecord', () => {
      expectTypeOf(cerniq.agents.create).returns.resolves.toMatchTypeOf<AgentRecord>();
    });

    it('list resolves to ListAgentsResponse', () => {
      expectTypeOf(cerniq.agents.list).returns.resolves.toMatchTypeOf<ListAgentsResponse>();
    });

    it('revoke resolves to void', () => {
      expectTypeOf(cerniq.agents.revoke).returns.resolves.toBeVoid();
    });
  });

  describe('PolicyClient — methods the CLI calls', () => {
    it('exposes create, list, get, revoke', () => {
      expect(typeof cerniq.policies.create).toBe('function');
      expect(typeof cerniq.policies.list).toBe('function');
      expect(typeof cerniq.policies.get).toBe('function');
      expect(typeof cerniq.policies.revoke).toBe('function');
    });

    it('get resolves to PolicyListItem (wired end-to-end in OD-024 Phase A1)', () => {
      expectTypeOf(cerniq.policies.get).returns.resolves.toMatchTypeOf<PolicyListItem>();
    });

    it('create resolves to PolicyRecord (both overloads)', () => {
      expectTypeOf(cerniq.policies.create).returns.resolves.toMatchTypeOf<PolicyRecord>();
    });

    it('list resolves to wrapped PolicyListResponse shape (CLI accesses .policies)', () => {
      expectTypeOf(cerniq.policies.list).returns.resolves.toMatchTypeOf<PolicyListResponse>();
    });

    it('revoke resolves to void', () => {
      expectTypeOf(cerniq.policies.revoke).returns.resolves.toBeVoid();
    });
  });
});
