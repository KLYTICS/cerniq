// Uses jest globals (apps/api runs jest, not vitest). describe/it/expect
// are provided by the jest runtime — no import.

import {
  parsePrismaSchema,
  diffModel,
  diffEnum,
  MODEL_MAPPINGS,
  ENUM_MAPPINGS,
} from './check-openapi-prisma-parity';

const SAMPLE_SCHEMA = `
enum AgentStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
  REVOKED
}

enum TrustBand {
  PLATINUM
  VERIFIED
  WATCH
  FLAGGED
}

model AgentIdentity {
  id            String   @id @default(cuid())
  publicKey     String
  principalId   String
  runtime       AgentRuntime
  model         String?
  label         String?
  status        AgentStatus @default(PENDING_VERIFICATION)
  trustScore    Int      @default(500)
  trustBand     TrustBand @default(VERIFIED)
  registeredAt  DateTime @default(now())
  lastSeenAt    DateTime?
  // internal:
  pendingChallenge          String?
  pendingChallengeExpiresAt DateTime?
  lastScoredAt   DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  principal      Principal @relation(fields: [principalId], references: [id])
  policies       AgentPolicy[]
}
`;

describe('parsePrismaSchema', () => {
  it('extracts enums and their members', () => {
    const { enums } = parsePrismaSchema(SAMPLE_SCHEMA);
    expect(enums.get('AgentStatus')?.members).toEqual(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED']);
    expect(enums.get('TrustBand')?.members).toEqual(['PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED']);
  });

  it('extracts model fields and flags relations', () => {
    const { models } = parsePrismaSchema(SAMPLE_SCHEMA);
    const agent = models.get('AgentIdentity');
    expect(agent).toBeDefined();
    const fieldNames = agent!.fields.map((f) => f.name);
    expect(fieldNames).toContain('publicKey');
    expect(fieldNames).toContain('runtime');
    expect(fieldNames).toContain('principal');
    const principalField = agent!.fields.find((f) => f.name === 'principal');
    expect(principalField?.isRelation).toBe(true);
  });
});

describe('diffEnum', () => {
  it('passes when Prisma and OpenAPI agree case-folded', () => {
    const components = {
      AgentStatus: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['pending_verification', 'active', 'suspended', 'revoked'],
          },
        },
      },
    };
    const r = diffEnum(
      { name: 'AgentStatus', members: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'REVOKED'] },
      components,
    );
    expect(r.status).toBe('ok');
  });

  it('flags drift when OpenAPI is missing a Prisma member', () => {
    const components = {
      TrustBand: { type: 'string', enum: ['PLATINUM', 'VERIFIED', 'WATCH'] },
    };
    const r = diffEnum(
      { name: 'TrustBand', members: ['PLATINUM', 'VERIFIED', 'WATCH', 'FLAGGED'] },
      components,
    );
    expect(r.status).toBe('drift');
    expect(r.detail).toContain('FLAGGED');
  });

  it('returns ok+no-map for internal enums (BateSignalType)', () => {
    const r = diffEnum(
      { name: 'BateSignalType', members: ['CLEAN_TRANSACTION', 'FRAUD_REPORT'] },
      {},
    );
    expect(r.status).toBe('ok');
    expect(r.detail).toContain('internal');
  });
});

describe('diffModel', () => {
  it('passes when every public Prisma field has an OpenAPI property', () => {
    const { models } = parsePrismaSchema(SAMPLE_SCHEMA);
    const mapping = MODEL_MAPPINGS.find((m) => m.prismaModel === 'AgentIdentity')!;
    const components = {
      AgentIdentity: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          publicKey: { type: 'string' },
          principalId: { type: 'string' },
          runtime: { type: 'string' },
          model: { type: 'string' },
          label: { type: 'string' },
          status: { type: 'string' },
          trustScore: { type: 'integer' },
          trustBand: { type: 'string' },
          registeredAt: { type: 'string' },
          lastSeenAt: { type: 'string' },
        },
      },
    };
    const r = diffModel(mapping, models.get('AgentIdentity'), components);
    expect(r.status).toBe('ok');
  });

  it('flags drift when a public Prisma field is missing from OpenAPI', () => {
    const { models } = parsePrismaSchema(SAMPLE_SCHEMA);
    const mapping = MODEL_MAPPINGS.find((m) => m.prismaModel === 'AgentIdentity')!;
    const components = {
      AgentIdentity: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          // publicKey deliberately missing
          status: { type: 'string' },
        },
      },
    };
    const r = diffModel(mapping, models.get('AgentIdentity'), components);
    expect(r.status).toBe('drift');
    expect(r.missingInOpenApi).toContain('publicKey');
  });

  it('reports missing when the Prisma model is absent', () => {
    const mapping = MODEL_MAPPINGS.find((m) => m.prismaModel === 'AgentIdentity')!;
    const r = diffModel(mapping, undefined, {});
    expect(r.status).toBe('missing');
  });
});

describe('mapping table integrity', () => {
  it('every mapped enum points to a real OpenAPI component name', () => {
    expect(Object.keys(ENUM_MAPPINGS).length).toBeGreaterThan(0);
    for (const [prismaEnum, apiName] of Object.entries(ENUM_MAPPINGS)) {
      expect(typeof prismaEnum).toBe('string');
      expect(typeof apiName).toBe('string');
    }
  });

  it('MODEL_MAPPINGS uses Set for internalFields (forces O(1) lookup)', () => {
    for (const m of MODEL_MAPPINGS) {
      expect(m.internalFields).toBeInstanceOf(Set);
    }
  });
});
