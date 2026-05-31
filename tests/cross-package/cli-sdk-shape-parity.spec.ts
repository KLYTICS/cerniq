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
// workspaces and skips the CLI. Method-presence checks on the class
// prototype would have failed instantly. That's what this spec encodes.
//
// Tightness chosen: **loose** — prototype method presence + return-type
// assertions. Parameter shapes intentionally not locked so SDK input
// ergonomics can evolve without test churn. Structural drift (a
// CLI-called method disappearing) trips immediately.
//
// IMPORTANT: imports are scoped to the class files only (NOT the package
// barrel `index.ts`). The barrel re-exports errors.ts which imports from
// `@cerniq/types` — that workspace package's `dist/` isn't built in the
// parity-tests CI job, so going through the barrel triggers a vite
// resolve failure. Importing the class files directly keeps the parity
// test self-contained.

import { describe, expect, expectTypeOf, it } from 'vitest';

import { AgentClient } from '../../packages/sdk-ts/src/agent';
import { PolicyClient } from '../../packages/sdk-ts/src/policy';
import type {
  AgentRecord,
  ListAgentsResponse,
  PolicyListItem,
  PolicyListResponse,
  PolicyRecord,
} from '../../packages/sdk-ts/src/types';

describe('CLI ↔ SDK contract parity (OD-024)', () => {
  describe('AgentClient — methods the CLI calls', () => {
    it('exposes register, create, list, get, revoke on the prototype', () => {
      expect(typeof AgentClient.prototype.register).toBe('function');
      expect(typeof AgentClient.prototype.create).toBe('function');
      expect(typeof AgentClient.prototype.list).toBe('function');
      expect(typeof AgentClient.prototype.get).toBe('function');
      expect(typeof AgentClient.prototype.revoke).toBe('function');
    });

    it('create resolves to AgentRecord', () => {
      expectTypeOf(AgentClient.prototype.create).returns.resolves.toMatchTypeOf<AgentRecord>();
    });

    it('list resolves to ListAgentsResponse', () => {
      expectTypeOf(AgentClient.prototype.list).returns.resolves.toMatchTypeOf<ListAgentsResponse>();
    });

    it('revoke resolves to void', () => {
      expectTypeOf(AgentClient.prototype.revoke).returns.resolves.toBeVoid();
    });
  });

  describe('PolicyClient — methods the CLI calls', () => {
    it('exposes create, list, get, revoke on the prototype', () => {
      expect(typeof PolicyClient.prototype.create).toBe('function');
      expect(typeof PolicyClient.prototype.list).toBe('function');
      expect(typeof PolicyClient.prototype.get).toBe('function');
      expect(typeof PolicyClient.prototype.revoke).toBe('function');
    });

    it('get resolves to PolicyListItem (OD-024 Phase A1 — throws until Phase A3 wires global lookup)', () => {
      expectTypeOf(PolicyClient.prototype.get).returns.resolves.toMatchTypeOf<PolicyListItem>();
    });

    it('create resolves to PolicyRecord (both overloads)', () => {
      expectTypeOf(PolicyClient.prototype.create).returns.resolves.toMatchTypeOf<PolicyRecord>();
    });

    it('list resolves to wrapped PolicyListResponse shape (CLI accesses .policies)', () => {
      expectTypeOf(PolicyClient.prototype.list).returns.resolves.toMatchTypeOf<PolicyListResponse>();
    });

    it('revoke resolves to void', () => {
      expectTypeOf(PolicyClient.prototype.revoke).returns.resolves.toBeVoid();
    });
  });
});
