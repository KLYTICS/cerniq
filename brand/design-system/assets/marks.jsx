// AEGIS — logomark explorations
// Six directions for the mark. All geometric, all scale to 16px,
// all monochrome-first. No shields, no padlocks, no eyes.

const INDIGO = '#3730A3';
const SLATE_900 = '#0F172A';
const SLATE_50  = '#F8FAFC';

// 1. KEYSTONE — a load-bearing wedge. Reads as "A" + cryptographic seal.
//    Two notched chevrons stacked, negative space carries a horizontal beam.
function MarkKeystone({ size = 96, fg = INDIGO, bg = 'transparent' }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill={bg} />
      <path d="M32 10 L52 50 H42 L38 42 H26 L22 50 H12 Z" fill={fg} />
      <rect x="26" y="32" width="12" height="3" fill={bg === 'transparent' ? '#fff' : bg} />
    </svg>
  );
}

// 2. APERTURE — concentric chevron, expressing the 4-layer stack.
//    Two stacked carets, the inner filled.
function MarkAperture({ size = 96, fg = INDIGO, bg = 'transparent' }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill={bg} />
      <path d="M14 44 L32 16 L50 44" stroke={fg} strokeWidth="3" strokeLinejoin="miter" fill="none" />
      <path d="M22 44 L32 28 L42 44 Z" fill={fg} />
    </svg>
  );
}

// 3. SEAL — a square rotated 45° with a horizontal slice. Reads as
//    sealed envelope, crystalline, two-stage attestation.
function MarkSeal({ size = 96, fg = INDIGO, bg = 'transparent' }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill={bg} />
      <path d="M32 12 L52 32 L32 52 L12 32 Z" stroke={fg} strokeWidth="3" fill="none" strokeLinejoin="miter" />
      <path d="M16 32 L48 32" stroke={fg} strokeWidth="3" />
      <path d="M32 12 L52 32 L32 32 Z" fill={fg} fillOpacity="0.18" />
    </svg>
  );
}

// 4. CHAIN — two interlocked square brackets, the audit-chain primitive.
function MarkChain({ size = 96, fg = INDIGO, bg = 'transparent' }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill={bg} />
      <path d="M22 14 H14 V50 H22" stroke={fg} strokeWidth="3" fill="none" strokeLinejoin="miter" />
      <path d="M42 14 H50 V50 H42" stroke={fg} strokeWidth="3" fill="none" strokeLinejoin="miter" />
      <rect x="20" y="30" width="24" height="4" fill={fg} />
    </svg>
  );
}

// 5. PRISM — a stylized A built from three planes.
//    Tri-plane wedge. Speaks to multi-layer verification.
function MarkPrism({ size = 96, fg = INDIGO, bg = 'transparent' }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill={bg} />
      <path d="M32 10 L52 50 H32 Z" fill={fg} />
      <path d="M32 10 L12 50 H32 Z" fill={fg} fillOpacity="0.55" />
      <path d="M22 38 H42 L38 30 H26 Z" fill={bg === 'transparent' ? '#fff' : bg} />
    </svg>
  );
}

// 6. GATE — a portal/threshold. The verification choke point made literal.
//    Two pillars and a beam, with a small notch.
function MarkGate({ size = 96, fg = INDIGO, bg = 'transparent' }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="12" fill={bg} />
      <rect x="14" y="20" width="8" height="34" fill={fg} />
      <rect x="42" y="20" width="8" height="34" fill={fg} />
      <rect x="14" y="14" width="36" height="8" fill={fg} />
      <rect x="30" y="14" width="4" height="8" fill={bg === 'transparent' ? '#fff' : bg} />
    </svg>
  );
}

Object.assign(window, {
  MarkKeystone, MarkAperture, MarkSeal, MarkChain, MarkPrism, MarkGate,
  BRAND: { INDIGO, SLATE_900, SLATE_50 }
});
