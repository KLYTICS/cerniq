// KmsModule — selects and registers the active `KmsAdapter` per
// `OKORO_KMS_PROVIDER` env (`in-memory`|`aws`|`gcp`|`vault`).
//
// The selected adapter is registered with `setKmsAdapter()` at module
// init so any code that calls `getKmsAdapter()` from
// `apps/api/src/common/crypto/crypto.bootstrap.ts` resolves the right
// implementation. ADR-0011 §3 commits this contract.
//
// Security: the production wiring helpers below are intentionally
// commented out. Real cloud SDK initialization must happen in
// `app.module.ts` (where AppConfigService is available) so this module
// stays import-safe for unit tests that mock the adapters.

import { Module, OnModuleInit, Provider } from '@nestjs/common';
import * as ed from '@noble/ed25519';

import {
  InMemoryKmsAdapter,
  setKmsAdapter,
  __resetKmsForTests,
  type KmsAdapter,
  type KeyMetadata,
} from '../../common/crypto/crypto.bootstrap';
import { MetricsService } from '../../common/observability/metrics.service';
import {
  CircuitBreaker,
  CIRCUIT_STATE_NUMERIC,
  type BreakerMetricsSink,
  type CircuitState,
} from '../../common/resilience/circuit-breaker';
import { AppConfigModule } from '../../config/config.module';
import { AppConfigService } from '../../config/config.service';

import { AwsKmsAdapter, type KmsClientLike } from './aws-kms.adapter';
import { GcpKmsAdapter, type GcpKmsClientLike } from './gcp-kms.adapter';
import { VaultTransitAdapter, type VaultClientLike } from './vault-transit.adapter';


/**
 * Adapt MetricsService to the framework-free `BreakerMetricsSink` shape so
 * `wrapWithBreaker` stays NestJS-free and reusable from edge runtimes.
 * Accepts `null` so dev/test bootstrap (no metrics provider wired) is a
 * silent no-op rather than a crash.
 */
function metricsSink(metrics: MetricsService | null): BreakerMetricsSink | undefined {
  if (!metrics) return undefined;
  return {
    setState: (name, numeric) =>
      { metrics.circuitBreakerStateGauge.set({ breaker: name }, numeric); },
    recordTrip: (name) =>
      { metrics.circuitBreakerTripsTotal.inc({ breaker: name }); },
  };
}

/** Build a configured breaker with optional metric wiring under a stable name. */
function makeBreaker<T>(
  name: string,
  sink: BreakerMetricsSink | undefined,
): CircuitBreaker<T> {
  return new CircuitBreaker<T>({
    name,
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    halfOpenMaxCalls: 1,
    onStateChange: sink
      ? (from: CircuitState, to: CircuitState) => {
          sink.setState(name, CIRCUIT_STATE_NUMERIC[to]);
          if (to === 'OPEN' && from !== 'OPEN') sink.recordTrip(name);
        }
      : undefined,
  });
}

const ACTIVE_KMS_ADAPTER = 'OKORO_ACTIVE_KMS_ADAPTER';

const kmsAdapterProvider: Provider = {
  provide: ACTIVE_KMS_ADAPTER,
  // MetricsService is `@Optional()` so this module can still bootstrap in
  // tests that don't import ObservabilityModule. Production wiring runs
  // through AppModule which always provides it via the @Global module.
  inject: [AppConfigService, { token: MetricsService, optional: true }],
  useFactory: async (
    config: AppConfigService,
    metrics: MetricsService | null,
  ): Promise<KmsAdapter> => {
    const provider = (config as unknown as { kmsProvider?: string }).kmsProvider ?? 'in-memory';
    switch (provider) {
      case 'in-memory':
        return await buildInMemory(config);
      case 'aws':
        return await buildAws(config, metrics);
      case 'gcp':
        return await buildGcp(config, metrics);
      case 'vault':
        return await buildVault(config, metrics);
      default:
        throw new Error(`Unknown OKORO_KMS_PROVIDER: ${provider}`);
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Cloud-KMS production builders (M-037 follow-on / Round 10).
//
// Each builder:
//   1. Lazy-loads its cloud SDK (so unit-test bundles aren't dragged into
//      pulling node-aws-sdk etc.).
//   2. Reads provider-specific config from AppConfigService (env-shaped).
//   3. Constructs the adapter, calls setKmsAdapter(), returns it.
//
// AppConfigService keys consumed (peer-owned schema additions when
// operator commits to a cloud provider):
//
//   AWS:    AWS_REGION
//           OKORO_AWS_KMS_AUDIT_KID, OKORO_AWS_KMS_AUDIT_WRAPPED, OKORO_AWS_KMS_AUDIT_PUB
//   GCP:    OKORO_GCP_KMS_AUDIT_KID, OKORO_GCP_KMS_AUDIT_RESOURCE, OKORO_GCP_KMS_AUDIT_PUB
//   Vault:  OKORO_VAULT_ADDR, OKORO_VAULT_TOKEN
//           OKORO_VAULT_AUDIT_KID, OKORO_VAULT_AUDIT_TRANSIT_NAME,
//           OKORO_VAULT_AUDIT_VERSION, OKORO_VAULT_AUDIT_PUB
//
// Operators wire any subset of (AUDIT, JWT, WEBHOOK) purposes; absent
// purposes will fail loud at sign-time if used.
// ─────────────────────────────────────────────────────────────────────────

async function buildAws(
  config: AppConfigService,
  metrics: MetricsService | null,
): Promise<KmsAdapter> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KMSClient, DecryptCommand } = require('@aws-sdk/client-kms') as typeof import('@aws-sdk/client-kms');
  const region = (config as unknown as { awsRegion?: string }).awsRegion;
  if (!region) throw new Error('AWS_REGION required for OKORO_KMS_PROVIDER=aws');
  const client = new KMSClient({ region });

  const cfg = (config as unknown as Record<string, string | undefined>);
  const auditKid = cfg.okoroAwsKmsAuditKid;
  const auditWrapped = cfg.okoroAwsKmsAuditWrapped;
  const auditPub = cfg.okoroAwsKmsAuditPub;
  if (!auditKid || !auditWrapped || !auditPub) {
    throw new Error('AwsKmsAdapter: OKORO_AWS_KMS_AUDIT_{KID,WRAPPED,PUB} all required');
  }

  // Single breaker per adapter instance — closure-captured by the decrypt
  // callback so trip state persists across calls.
  const decryptBreaker = makeBreaker<{ Plaintext: Uint8Array | undefined }>(
    'kms.aws.decrypt',
    metricsSink(metrics),
  );
  const adapter = new AwsKmsAdapter(
    {
      region,
      keys: {
        AUDIT: {
          kid: auditKid,
          wrappedPrivateKeyB64: auditWrapped,
          publicKey: auditPub,
          algorithm: 'EdDSA',
          validFrom: new Date().toISOString(),
          validUntil: null,
        },
      },
    },
    {
      decrypt: (input: Parameters<KmsClientLike['decrypt']>[0]) =>
        decryptBreaker.exec(async () => {
          const out = await client.send(
            new DecryptCommand({ CiphertextBlob: input.CiphertextBlob }),
          );
          return { Plaintext: out.Plaintext };
        }),
    },
  );
  await adapter.init();
  setKmsAdapter(adapter);
  return adapter;
}

async function buildGcp(
  config: AppConfigService,
  metrics: MetricsService | null,
): Promise<KmsAdapter> {
  // type-rationale: `@google-cloud/kms` is declared in package.json but the
  // workspace install may omit the platform-specific google-gax binaries on
  // dev machines, so `typeof import(...)` resolution fails. We pin the
  // structural surface we use (just `asymmetricSign`) inline; the adapter
  // owns the fully-typed `GcpKmsClientLike` contract.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { KeyManagementServiceClient } = require('@google-cloud/kms') as {
    KeyManagementServiceClient: new () => {
      asymmetricSign(req: { name: string; data: Uint8Array }): Promise<[{ signature?: Uint8Array | string | null }]>;
    };
  };
  const client = new KeyManagementServiceClient();

  const cfg = (config as unknown as Record<string, string | undefined>);
  const auditKid = cfg.okoroGcpKmsAuditKid;
  const auditResource = cfg.okoroGcpKmsAuditResource;
  const auditPub = cfg.okoroGcpKmsAuditPub;
  if (!auditKid || !auditResource || !auditPub) {
    throw new Error('GcpKmsAdapter: OKORO_GCP_KMS_AUDIT_{KID,RESOURCE,PUB} all required');
  }

  const signBreaker = makeBreaker<{ signature: Uint8Array }>(
    'kms.gcp.sign',
    metricsSink(metrics),
  );
  const adapter = new GcpKmsAdapter(
    {
      keys: {
        AUDIT: [
          {
            kid: auditKid,
            resourceName: auditResource,
            publicKey: auditPub,
            algorithm: 'EdDSA',
            validFrom: new Date().toISOString(),
            validUntil: null,
          },
        ],
      },
    },
    {
      asymmetricSign: ({ name, data }: Parameters<GcpKmsClientLike['asymmetricSign']>[0]) =>
        signBreaker.exec(async () => {
          const [resp] = await client.asymmetricSign({ name, data });
          return { signature: resp.signature as Uint8Array };
        }),
    },
  );
  setKmsAdapter(adapter);
  return adapter;
}

async function buildVault(
  config: AppConfigService,
  metrics: MetricsService | null,
): Promise<KmsAdapter> {
  const cfg = (config as unknown as Record<string, string | undefined>);
  const addr = cfg.okoroVaultAddr;
  const token = cfg.okoroVaultToken;
  const auditKid = cfg.okoroVaultAuditKid;
  const transitName = cfg.okoroVaultAuditTransitName;
  const auditVersionStr = cfg.okoroVaultAuditVersion;
  const auditPub = cfg.okoroVaultAuditPub;
  if (!addr || !token || !auditKid || !transitName || !auditVersionStr || !auditPub) {
    throw new Error('VaultTransitAdapter: OKORO_VAULT_{ADDR,TOKEN,AUDIT_KID,AUDIT_TRANSIT_NAME,AUDIT_VERSION,AUDIT_PUB} all required');
  }
  const auditVersion = Number.parseInt(auditVersionStr, 10);

  const vaultBreaker = makeBreaker<{ data: { signature: string } }>(
    'kms.vault.sign',
    metricsSink(metrics),
  );
  const adapter = new VaultTransitAdapter(
    {
      keys: {
        AUDIT: [
          {
            kid: auditKid,
            transitName,
            version: auditVersion,
            publicKey: auditPub,
            algorithm: 'EdDSA',
            validFrom: new Date().toISOString(),
            validUntil: null,
          },
        ],
      },
    },
    {
      signTransit: ({ name, input }: Parameters<VaultClientLike['signTransit']>[0]) =>
        vaultBreaker.exec(async () => {
          const res = await fetch(
            `${addr.replace(/\/$/, '')}/v1/transit/sign/${encodeURIComponent(name)}`,
            {
              method: 'POST',
              headers: { 'X-Vault-Token': token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ input }),
            },
          );
          if (!res.ok) {
            throw new Error(`vault sign failed: ${res.status} ${res.statusText}`);
          }
          return (await res.json()) as { data: { signature: string } };
        }),
    },
  );
  setKmsAdapter(adapter);
  return adapter;
}

@Module({
  imports: [AppConfigModule],
  providers: [kmsAdapterProvider],
  exports: [kmsAdapterProvider],
})
export class KmsModule implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // The provider above already constructed the adapter. Register the
    // singleton accessor used by hot-path code (audit chain sign,
    // /.well-known publishing).
    // Note: in tests, modules construct the InMemoryKmsAdapter directly
    // and call setKmsAdapter(); this module is only used when the API
    // bootstraps via AppModule.
  }
}

async function buildInMemory(config: AppConfigService): Promise<InMemoryKmsAdapter> {
  const adapter = new InMemoryKmsAdapter();

  // Audit signing key — read from env if present, else generate ephemeral.
  const auditPriv = (config as unknown as { auditEd25519PrivateB64?: string }).auditEd25519PrivateB64;
  const auditPub = (config as unknown as { auditEd25519PublicB64?: string }).auditEd25519PublicB64;
  const isProd = (config as unknown as { nodeEnv?: string }).nodeEnv === 'production';

  if (auditPriv && auditPub) {
    adapter.registerKey({
      kid: 'kid-genesis-v1',
      purpose: 'AUDIT',
      privateKey: decodeB64u(auditPriv),
      publicKey: auditPub,
      algorithm: 'EdDSA',
      validFrom: new Date().toISOString(),
      validUntil: null,
    });
  } else if (isProd) {
    throw new Error('AUDIT_ED25519_PRIVATE_KEY_B64 and _PUBLIC_KEY_B64 required in production');
  } else {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    adapter.registerKey({
      kid: 'kid-dev-audit',
      purpose: 'AUDIT',
      privateKey: priv,
      publicKey: bufferToB64u(pub),
      algorithm: 'EdDSA',
      validFrom: new Date().toISOString(),
      validUntil: null,
    });
  }

  // JWT signing key — same env pattern.
  const jwtPriv = (config as unknown as { jwtEd25519PrivateB64?: string }).jwtEd25519PrivateB64;
  const jwtPub = (config as unknown as { jwtEd25519PublicB64?: string }).jwtEd25519PublicB64;
  if (jwtPriv && jwtPub) {
    adapter.registerKey({
      kid: 'kid-genesis-v1-jwt',
      purpose: 'JWT',
      privateKey: decodeB64u(jwtPriv),
      publicKey: jwtPub,
      algorithm: 'EdDSA',
      validFrom: new Date().toISOString(),
      validUntil: null,
    });
  } else if (!isProd) {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    adapter.registerKey({
      kid: 'kid-dev-jwt',
      purpose: 'JWT',
      privateKey: priv,
      publicKey: bufferToB64u(pub),
      algorithm: 'EdDSA',
      validFrom: new Date().toISOString(),
      validUntil: null,
    });
  }

  setKmsAdapter(adapter);
  return adapter;
}

function decodeB64u(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, 'base64url'));
}
function bufferToB64u(b: Uint8Array): string {
  return Buffer.from(b).toString('base64url');
}

/** Test helper. Production code MUST NOT call this. */
export function __testResetKms(): void {
  __resetKmsForTests();
}

// Export the adapter classes so AppModule can construct them with the
// real cloud SDKs at boot time.
export { AwsKmsAdapter } from './aws-kms.adapter';
export { GcpKmsAdapter } from './gcp-kms.adapter';
export { VaultTransitAdapter } from './vault-transit.adapter';
export type { KeyMetadata };
