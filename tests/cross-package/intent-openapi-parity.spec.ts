// Cross-package parity — OpenAPI /v1/intent surface ↔ Nest DTOs.
//
// Three intent endpoints in docs/spec/AEGIS_API_SPEC.yaml (added under
// ADR-0017) must agree with the Nest DTOs in
// apps/api/src/modules/intent/intent.dto.ts. Drift here means:
//   - the SDK and the API disagree about request shapes (silent 400s)
//   - the published OpenAPI doc-set lies about response shapes
//
// This spec is purpose-built around regex parsing rather than full
// OpenAPI schema-walking — the yaml has been stable in shape across
// the audit + verify endpoints and the same approach keeps this gate
// fast (no js-yaml install, no jest-openapi dep).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const SPEC = readFileSync(resolve(REPO_ROOT, 'docs/spec/AEGIS_API_SPEC.yaml'), 'utf8');
const DTO_SRC = readFileSync(
  resolve(REPO_ROOT, 'apps/api/src/modules/intent/intent.dto.ts'),
  'utf8',
);

describe('OpenAPI ↔ intent.dto.ts parity (ADR-0017)', () => {
  describe('endpoint surface', () => {
    it('declares POST /v1/intent', () => {
      expect(SPEC).toMatch(/\n {2}\/v1\/intent:\s*\n {4}post:/);
    });

    it('declares POST /v1/intent/{manifestId}/actuals with required Idempotency-Key', () => {
      expect(SPEC).toMatch(/\n {2}\/v1\/intent\/\{manifestId\}\/actuals:\s*\n {4}post:/);
      // Idempotency-Key header is REQUIRED per ADR-0017
      const actualsBlock = SPEC.split('/v1/intent/{manifestId}/actuals:')[1] ?? '';
      const nextEndpoint = actualsBlock.split('\n  /v1/')[0] ?? actualsBlock;
      expect(nextEndpoint).toMatch(/name: Idempotency-Key[\s\S]*?required: true/);
    });

    it('declares GET /v1/intent/{manifestId}', () => {
      expect(SPEC).toMatch(/\n {2}\/v1\/intent\/\{manifestId\}:\s*\n {4}get:/);
    });
  });

  describe('component schemas', () => {
    it.each([
      'IntentClaim',
      'ReconciliationPolicy',
      'SignedIntentManifest',
      'IssueIntentRequest',
      'IssueIntentResponse',
      'ActualCallObservation',
      'ReconcileIntentRequest',
      'IntentMismatch',
      'ReconcileIntentResponse',
      'GetIntentResponse',
    ])('defines schema %s', (schemaName) => {
      // Component schemas are indented 4 spaces under `components: schemas:`.
      const re = new RegExp(`\\n {4}${schemaName}:\\s*\\n {6}type: object`);
      expect(SPEC).toMatch(re);
    });
  });

  describe('IntentClaim discriminator alignment', () => {
    it('OpenAPI IntentClaim.kind enum matches DTO IntentClaimDto.kind union', () => {
      // SPEC: kind: enum: [http-call, commerce-action, tool-invocation]
      const specKindMatch = SPEC.match(
        /IntentClaim:[\s\S]*?kind:\s*\n\s+type: string\s*\n\s+enum: \[([^\]]+)\]/,
      );
      expect(specKindMatch).not.toBeNull();
      const specKinds = (specKindMatch![1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .sort();

      // DTO: @IsIn(['http-call', 'commerce-action', 'tool-invocation'])
      const dtoKindMatch = DTO_SRC.match(
        /class IntentClaimDto[\s\S]*?@IsIn\(\[([^\]]+)\]\)/,
      );
      expect(dtoKindMatch).not.toBeNull();
      const dtoKinds = (dtoKindMatch![1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .filter((s) => s.length > 0)
        .sort();

      expect(specKinds).toEqual(dtoKinds);
    });
  });

  describe('ReconciliationPolicy strictness alignment', () => {
    it('OpenAPI strictness enum matches DTO union', () => {
      const specMatch = SPEC.match(
        /ReconciliationPolicy:[\s\S]*?strictness:\s*\n\s+type: string\s*\n\s+enum: \[([^\]]+)\]/,
      );
      expect(specMatch).not.toBeNull();
      const specStrictness = (specMatch![1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .sort();

      const dtoMatch = DTO_SRC.match(
        /class ReconciliationPolicyDto[\s\S]*?@IsIn\(\[([^\]]+)\]\)/,
      );
      expect(dtoMatch).not.toBeNull();
      const dtoStrictness = (dtoMatch![1] ?? '')
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''))
        .sort();

      expect(specStrictness).toEqual(dtoStrictness);
    });
  });

  describe('IntentMismatch kind enum alignment', () => {
    it('OpenAPI IntentMismatch.kind matches the kernel IntentMismatchKind union', () => {
      // OpenAPI side
      const specMatch = SPEC.match(
        /IntentMismatch:[\s\S]*?kind:\s*\n\s+type: string\s*\n\s+enum:([\s\S]*?)(?:\n\s+\w+:|$)/,
      );
      expect(specMatch).not.toBeNull();
      const specKinds = [
        ...(specMatch![1] ?? '').matchAll(/^\s*-\s+([a-z][a-z0-9-]+)/gm),
      ]
        .map((m) => m[1]!)
        .sort();

      // Kernel side: read packages/intent-manifest/src/types.ts for the
      // IntentMismatchKind union members.
      const kernelTypes = readFileSync(
        resolve(REPO_ROOT, 'packages/intent-manifest/src/types.ts'),
        'utf8',
      );
      const kernelMatch = kernelTypes.match(
        /export type IntentMismatchKind\s*=([\s\S]*?);/,
      );
      expect(kernelMatch).not.toBeNull();
      const kernelKinds = [
        ...(kernelMatch![1] ?? '').matchAll(/'([a-z][a-z0-9-]+)'/g),
      ]
        .map((m) => m[1]!)
        .sort();

      expect(specKinds).toEqual(kernelKinds);
    });
  });

  describe('recommendedDenialReason wire contract', () => {
    it('OpenAPI ReconcileIntentResponse.recommendedDenialReason has INTENT_MISMATCH enum value + nullable: true', () => {
      const block = SPEC.match(
        /ReconcileIntentResponse:[\s\S]*?recommendedDenialReason:([\s\S]*?)(?:\n\s{8}\w+:|$)/,
      );
      expect(block).not.toBeNull();
      const body = block![1] ?? '';
      expect(body).toMatch(/nullable: true/);
      expect(body).toMatch(/- INTENT_MISMATCH/);
    });

    it('kernel emits the literal string INTENT_MISMATCH (matches OpenAPI enum)', () => {
      const reconcile = readFileSync(
        resolve(REPO_ROOT, 'packages/intent-manifest/src/reconcile.ts'),
        'utf8',
      );
      expect(reconcile).toContain(`INTENT_MISMATCH_DENIAL_REASON = 'INTENT_MISMATCH'`);
    });
  });

  describe('module gating disclosure', () => {
    it('spec advertises AEGIS_INTENT_MANIFEST_ENABLED gating', () => {
      // Operators reading the spec need to know intent endpoints are
      // off by default. This assertion guards the disclosure.
      expect(SPEC).toMatch(/AEGIS_INTENT_MANIFEST_ENABLED/);
    });
  });
});
