import { Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfigService } from '../../config/config.service';

export interface AuthenticatedKey {
  apiKeyId: string;
  principalId: string;
  scope: 'FULL' | 'VERIFY_ONLY';
}

@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Generate a fresh API key for a principal. Returns the plaintext exactly
   * once; only the bcrypt hash is persisted.
   *
   * Format: `aegis_sk_<26 char base58-ish>` (verify keys: `aegis_vk_…`).
   */
  async issue(principalId: string, label: string | null, scope: AuthenticatedKey['scope'] = 'FULL'): Promise<{
    apiKeyId: string;
    plaintextKey: string;
    keyPrefix: string;
  }> {
    const prefix = scope === 'VERIFY_ONLY' ? 'aegis_vk_' : 'aegis_sk_';
    const random = randomBytes(24).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 26);
    const plaintext = `${prefix}${random}`;
    const keyPrefix = plaintext.slice(0, 12); // For dashboard display only.

    const hash = await bcrypt.hash(plaintext, this.config.apiKeyBcryptCost);

    const created = await this.prisma.apiKey.create({
      data: { keyHash: hash, keyPrefix, label, principalId, scope },
    });

    return { apiKeyId: created.id, plaintextKey: plaintext, keyPrefix };
  }

  /**
   * Resolve a presented plaintext key to a principal.
   *
   * NOTE: bcrypt comparison is intentionally constant-time. We narrow the
   * candidate set with `keyPrefix` (no secret leak — prefix is public).
   * For ~10s of thousands of keys this is fine; at >100k we shard by prefix.
   */
  async resolve(plaintext: string): Promise<AuthenticatedKey | null> {
    if (!plaintext || (!plaintext.startsWith('aegis_sk_') && !plaintext.startsWith('aegis_vk_'))) {
      return null;
    }
    const keyPrefix = plaintext.slice(0, 12);
    const candidates = await this.prisma.apiKey.findMany({
      where: { keyPrefix, revokedAt: null },
      select: { id: true, keyHash: true, principalId: true, scope: true },
    });

    for (const c of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await bcrypt.compare(plaintext, c.keyHash);
      if (ok) {
        // Update lastUsedAt — fire and forget.
        this.prisma.apiKey
          .update({ where: { id: c.id }, data: { lastUsedAt: new Date() } })
          .catch((err) => this.logger.warn(`apiKey lastUsedAt update failed: ${err.message}`));
        return { apiKeyId: c.id, principalId: c.principalId, scope: c.scope as AuthenticatedKey['scope'] };
      }
    }
    return null;
  }
}
