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

  @ApiProperty({ description: 'base64url-encoded raw 32-byte Ed25519 public key.' })
  publicKey!: string;

  @ApiProperty({ enum: ['EdDSA'], example: 'EdDSA' })
  algorithm!: 'EdDSA';

  @ApiProperty({ enum: ['Ed25519'], example: 'Ed25519' })
  curve!: 'Ed25519';

  @ApiProperty({ example: 'https://cerniqapp.com' })
  issuer!: string;

  @ApiProperty({ description: 'ISO timestamp when this key was activated.' })
  rotatedAt!: string;

  @ApiProperty({ enum: ['audit-event-signing'], example: 'audit-event-signing' })
  purpose!: 'audit-event-signing';

  @ApiProperty({ example: 'https://docs.cerniqapp.com/audit/verify' })
  verificationGuide!: string;
}
