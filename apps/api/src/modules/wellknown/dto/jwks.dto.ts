import { ApiProperty } from '@nestjs/swagger';

/**
 * RFC 8037 — Ed25519 in JOSE.
 *
 * `kty=OKP`, `crv=Ed25519`, `x` is the base64url-encoded raw 32-byte public key.
 * `alg=EdDSA` and `use=sig` are advisory; relying parties MAY pin them to reject
 * unintended-use mismatches.
 */
export class JwkEd25519Dto {
  @ApiProperty({ enum: ['OKP'], example: 'OKP' })
  kty!: 'OKP';

  @ApiProperty({ enum: ['Ed25519'], example: 'Ed25519' })
  crv!: 'Ed25519';

  @ApiProperty({ enum: ['EdDSA'], example: 'EdDSA' })
  alg!: 'EdDSA';

  @ApiProperty({ enum: ['sig'], example: 'sig' })
  use!: 'sig';

  @ApiProperty({ description: 'Stable key id — sha256(rawPublicKey) base64url, first 16 chars.' })
  kid!: string;

  @ApiProperty({ description: 'base64url-encoded raw 32-byte Ed25519 public key.' })
  x!: string;
}

export class JwksDto {
  @ApiProperty({ type: [JwkEd25519Dto] })
  keys!: JwkEd25519Dto[];
}

export class AuditSigningKeyDto {
  @ApiProperty({ description: 'Stable key id — sha256(rawPublicKey) base64url, first 16 chars.' })
  kid!: string;

  @ApiProperty({
    description: 'base64url-encoded raw 32-byte Ed25519 public key (verbose alias of `x`).',
  })
  publicKey!: string;

  @ApiProperty({ enum: ['EdDSA'], example: 'EdDSA', description: 'Verbose alias of `alg`.' })
  algorithm!: 'EdDSA';

  @ApiProperty({ enum: ['Ed25519'], example: 'Ed25519', description: 'Verbose alias of `crv`.' })
  curve!: 'Ed25519';

  // ── RFC 8037 JWK fields (additive — lets JOSE consumers parse this
  // single-key response without falling back to /.well-known/jwks.json).
  @ApiProperty({ enum: ['OKP'], example: 'OKP', description: 'RFC 8037 key type.' })
  kty!: 'OKP';

  @ApiProperty({ enum: ['Ed25519'], example: 'Ed25519', description: 'RFC 8037 curve.' })
  crv!: 'Ed25519';

  @ApiProperty({ enum: ['EdDSA'], example: 'EdDSA', description: 'RFC 8037 algorithm.' })
  alg!: 'EdDSA';

  @ApiProperty({ enum: ['sig'], example: 'sig', description: 'RFC 8037 intended use.' })
  use!: 'sig';

  @ApiProperty({
    description: 'RFC 8037 raw public key — base64url-encoded 32 bytes. Identical to `publicKey`.',
  })
  x!: string;

  @ApiProperty({ example: 'https://aegislabs.io' })
  issuer!: string;

  @ApiProperty({ description: 'ISO timestamp when this key was activated.' })
  rotatedAt!: string;

  @ApiProperty({ enum: ['audit-event-signing'], example: 'audit-event-signing' })
  purpose!: 'audit-event-signing';

  @ApiProperty({ example: 'https://docs.aegislabs.io/audit/verify' })
  verificationGuide!: string;
}
