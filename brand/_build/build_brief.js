/* ============================================================================
   OKORO Brand Brief — DOCX generator
   Run: node build_brief.js
   ============================================================================ */
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak, TabStopType,
  TabStopPosition, TableOfContents
} = require("docx");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const FONT = "Arial";
const MONO = "Consolas";
const COLOR = {
  ink: "0B1020",
  cyan: "0E8FA8",   // darker cyan for print legibility
  violet: "5B3FBF", // darker violet for print legibility
  fog: "5C667A",
  rule: "C8CCD4",
  panel: "F2F4F8"
};

const space = (pts) => pts * 20; // 1 pt = 20 DXA in docx-js spacing units

const p = (text, opts = {}) => new Paragraph({
  spacing: { before: opts.before ?? 60, after: opts.after ?? 60, line: 320 },
  alignment: opts.align ?? AlignmentType.LEFT,
  children: [new TextRun({
    text,
    font: opts.mono ? MONO : FONT,
    size: opts.size ?? 22, // half-points; 22 = 11pt
    bold: opts.bold ?? false,
    italics: opts.italics ?? false,
    color: opts.color ?? COLOR.ink
  })]
});

const lead = (text, opts = {}) => new Paragraph({
  spacing: { before: 80, after: 200, line: 320 },
  children: [new TextRun({ text, font: FONT, size: 26, color: COLOR.fog })]
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  pageBreakBefore: true,
  spacing: { before: 0, after: 280 },
  children: [new TextRun({ text, font: FONT, size: 56, bold: true, color: COLOR.ink })]
});

const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 360, after: 160 },
  children: [new TextRun({ text, font: FONT, size: 36, bold: true, color: COLOR.ink })]
});

const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, font: FONT, size: 26, bold: true, color: COLOR.ink })]
});

const eyebrow = (text) => new Paragraph({
  spacing: { before: 200, after: 60 },
  children: [new TextRun({
    text: text.toUpperCase(),
    font: FONT, size: 18, bold: true, color: COLOR.cyan,
    characterSpacing: 80 // letter-spacing
  })]
});

const bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: "bullets", level },
  spacing: { before: 40, after: 40, line: 300 },
  children: [new TextRun({ text, font: FONT, size: 22, color: COLOR.ink })]
});

const number = (text) => new Paragraph({
  numbering: { reference: "numbers", level: 0 },
  spacing: { before: 60, after: 60, line: 300 },
  children: [new TextRun({ text, font: FONT, size: 22, color: COLOR.ink })]
});

const inlineMono = (parts) => new Paragraph({
  spacing: { before: 60, after: 60, line: 300 },
  children: parts.map(([text, isMono, isBold]) => new TextRun({
    text, font: isMono ? MONO : FONT, size: 22,
    color: isMono ? COLOR.cyan : COLOR.ink,
    bold: !!isBold
  }))
});

const rule = () => new Paragraph({
  spacing: { before: 120, after: 120 },
  border: { bottom: { color: COLOR.rule, size: 6, space: 1, style: BorderStyle.SINGLE } },
  children: [new TextRun({ text: "" })]
});

const callout = (label, body) => {
  const cell = new TableCell({
    width: { size: 9360, type: WidthType.DXA },
    shading: { fill: COLOR.panel, type: ShadingType.CLEAR },
    margins: { top: 200, bottom: 200, left: 280, right: 280 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: COLOR.cyan },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: COLOR.rule },
      left: { style: BorderStyle.SINGLE, size: 2, color: COLOR.rule },
      right: { style: BorderStyle.SINGLE, size: 2, color: COLOR.rule }
    },
    children: [
      new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({
          text: label.toUpperCase(),
          font: FONT, size: 18, bold: true, color: COLOR.cyan,
          characterSpacing: 80
        })]
      }),
      new Paragraph({
        spacing: { before: 0, after: 0, line: 320 },
        children: [new TextRun({ text: body, font: FONT, size: 22, color: COLOR.ink })]
      })
    ]
  });
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({ children: [cell] })]
  });
};

// 2-col benchmark table
const benchmarkBlock = ({ rank, name, tagline, why, steal, caveat }) => {
  const noBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
  };
  const labelStyle = { font: FONT, size: 18, bold: true, color: COLOR.cyan, characterSpacing: 80 };

  const rows = [];
  rows.push(new TableRow({
    children: [
      new TableCell({
        width: { size: 1200, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 0, right: 200 },
        borders: noBorders,
        children: [new Paragraph({ children: [new TextRun({
          text: String(rank).padStart(2, "0"),
          font: FONT, size: 64, bold: true, color: COLOR.cyan
        })] })]
      }),
      new TableCell({
        width: { size: 8160, type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 0, right: 0 },
        borders: noBorders,
        children: [
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [new TextRun({ text: name, font: FONT, size: 32, bold: true, color: COLOR.ink })]
          }),
          new Paragraph({
            spacing: { before: 0, after: 120 },
            children: [new TextRun({ text: tagline, font: FONT, size: 22, italics: true, color: COLOR.fog })]
          }),
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [new TextRun({ ...labelStyle, text: "WHY STUDY THEM" })]
          }),
          new Paragraph({
            spacing: { before: 0, after: 160, line: 300 },
            children: [new TextRun({ text: why, font: FONT, size: 22, color: COLOR.ink })]
          }),
          new Paragraph({
            spacing: { before: 0, after: 40 },
            children: [new TextRun({ ...labelStyle, text: "WHAT TO STEAL" })]
          }),
          ...steal.map(s => new Paragraph({
            numbering: { reference: "bullets", level: 0 },
            spacing: { before: 30, after: 30, line: 300 },
            children: [new TextRun({ text: s, font: FONT, size: 22, color: COLOR.ink })]
          })),
          new Paragraph({
            spacing: { before: 120, after: 40 },
            children: [new TextRun({ ...labelStyle, text: "DON'T COPY" })]
          }),
          new Paragraph({
            spacing: { before: 0, after: 0, line: 300 },
            children: [new TextRun({ text: caveat, font: FONT, size: 22, color: COLOR.fog, italics: true })]
          })
        ]
      })
    ]
  }));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1200, 8160],
    rows
  });
};

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------
const benchmarks = [
  {
    rank: 1, name: "Linear",
    tagline: "The issue tracker for high-performance software teams.",
    why: "Linear set the bar for B2B SaaS visual quality in this decade. Their dark interface, micro-interactions, type, and motion are the gold standard every infrastructure brand is now measured against. They proved that a developer tool can be cinematic.",
    steal: [
      "The signature ease-out-expo motion curve — cubic-bezier(0.16, 1, 0.3, 1). Already adopted as our motion signature.",
      "Restraint with color. Linear's interface is 95% greyscale; the brand color is a punctuation mark, not a fill.",
      "Keyboard-first design language. OKORO is for builders — surface every action with a kbd hint and a Cmd-K palette.",
      "Section-head pattern: small uppercase eyebrow + headline + one-sentence lead. We've adopted this throughout."
    ],
    caveat: "Don't copy their purple — it's distinctive and ownable for them. Our cyan/violet aurora needs to be unmistakably ours."
  },
  {
    rank: 2, name: "Vercel",
    tagline: "Develop. Preview. Ship.",
    why: "Vercel mastered the minimalist edge-tech aesthetic. Their use of monospace for technical credibility, geometric mark, and signature gradient mesh became a category-defining language for developer infrastructure.",
    steal: [
      "Mono as a brand voice — not just for code. Vercel uses mono for nav meta, status pills, agent IDs. We adopt this for cryptographic strings (signatures, public keys, agent IDs).",
      "Black-on-black layering. Surfaces stack with 1px hairline borders rather than heavy shadows.",
      "Geometric mark that works at 16px favicon scale and a billboard. Our shield is built to the same brief.",
      "Gradient mesh as ambient lighting. Used as background atmosphere, not as foreground fill."
    ],
    caveat: "Vercel's brand is intentionally austere — almost cold. OKORO needs more warmth in copy and the editorial serif moments to avoid feeling like a clone."
  },
  {
    rank: 3, name: "Stripe",
    tagline: "Financial infrastructure for the internet.",
    why: "Stripe is the masterclass in B2B trust through design. Their gradient mastery, immersive product page scrolling, and brand architecture (Stripe + Atlas + Issuing + Radar...) is the playbook for an infrastructure company that wants to expand into a category.",
    steal: [
      "The Stripe-style scrolling product page — full-bleed sections with cinematic reveals, code blocks integrated as hero content, and a genuine sense of narrative.",
      "Brand architecture: a strong parent mark with named sub-products (Stripe Atlas, Stripe Issuing). When OKORO spawns sub-products (Okoro Audit, Okoro Policies, Okoro Court), follow this exact pattern.",
      "Gradients with intent. Stripe's gradients evoke specific moods — payments are warm pink/orange, infrastructure is cool blue/violet. Our aurora is reserved for the hero moment.",
      "The 'developer mode' product pages — code-heavy, technical, but visually beautiful. Pure inspiration for our docs."
    ],
    caveat: "Don't copy Stripe's specific gradient palette (pink/purple/blue) — it's owned. Our cyan/violet/magenta aurora is in a related family but tuned cooler and more cryptographic."
  },
  {
    rank: 4, name: "Apple — Apple Intelligence / Vision Pro pages",
    tagline: "If you have to ask, it's not for you.",
    why: "Apple's product marketing pages are the cinematic immersive standard. Full-bleed scenes, scroll-pinned video, dramatic typography breathing, restraint to the point of audacity. The visual confidence is the message.",
    steal: [
      "Confidence through restraint. One headline, one visual, one sentence of subhead — repeat. Don't crowd a section because there is information available.",
      "Video and 3D-rendered scenes as the hero unit. OKORO should commission a 3D render of the shield mark with aurora light, looping subtly, as the homepage hero.",
      "Dramatic type sizing. Display-XL (112px+) used once per page as the anchor. Italics-serif accent line beneath. We've encoded this in the type scale.",
      "Section transitions that pause. Don't crossfade or slide — let one section settle before the next begins (240ms+ pause on viewport entry)."
    ],
    caveat: "Apple has the budget to commission custom-rendered hero animations for every product page. OKORO gets one signature 3D render and reuses it. Don't try to match Apple's volume."
  },
  {
    rank: 5, name: "Anthropic",
    tagline: "AI safety is a research and applied effort.",
    why: "OKORO lives next door to Anthropic in market positioning (AI infrastructure, trust, safety). Visual harmony with Anthropic's brand prevents OKORO from looking like an unrelated startup and accelerates the implicit credibility transfer for relying parties who already trust Claude.",
    steal: [
      "Restraint with serif. Anthropic uses Söhne Mono / Tiempos / their custom serif sparingly. We mirror with Instrument Serif italic, used once per page, always intentional.",
      "Warmth in a technical brand. Anthropic's off-white and cream tones soften the cold-tech default. OKORO uses Halo (#F4F6FF) instead of pure white for the same reason.",
      "Conversational headline voice. 'A new way to build with Claude.' Our equivalent: 'Verified. Or it didn't happen.'",
      "Editorial-style essays as marketing. Anthropic's research posts are core brand. OKORO should publish trust-and-safety essays in the same register."
    ],
    caveat: "Don't copy Anthropic's specific color palette or the cream backgrounds — that would read as a knock-off. Adjacent type philosophy and tonal warmth, not visual mimicry."
  },
  {
    rank: 6, name: "Arc Browser (The Browser Company)",
    tagline: "A browser that's actually for you.",
    why: "Arc proved that infrastructure software can have a soul. Their hand-crafted feel, surprise-and-delight micro-moments, and emotional product reveals raised the ceiling for what a dev tool brand can feel like.",
    steal: [
      "Surprise and delight in microcopy. Arc's empty states, loading messages, and 404 page have personality. OKORO verification successes should have a moment ('signed and sealed', 'verdict cached for 60s') without becoming twee.",
      "The animated product reveal video. Arc's launch films are paced like a movie trailer. OKORO deserves a 60-second narrative film for the homepage hero.",
      "Soft shadows and rounded corners that feel hand-drawn. We borrow the warmth without going full skeuomorphic.",
      "Intentional onboarding choreography. Arc's first-run is a guided cinematic experience. OKORO dashboard onboarding should be the same — not a checklist, a choreographed reveal."
    ],
    caveat: "Arc's whimsy is built on consumer-product latitude. OKORO is infrastructure for compliance teams. Steal the feeling of care, not the playful illustrations."
  },
  {
    rank: 7, name: "Framer",
    tagline: "The design tool that codes for you.",
    why: "Framer is the industry leader in motion-as-language. Their gradient meshes, fluid type, and scroll-driven reveals are the most aggressive use of modern web capabilities for a B2B brand.",
    steal: [
      "Fluid type with clamp(). Headlines that scale with viewport without media-query breakpoints feel cinematic. We've encoded clamp() in the hero CSS.",
      "Animated gradient meshes as living backgrounds — never static, never distracting. Use as ambient lighting for hero sections.",
      "Scroll-pinned story sections. As you scroll, the visual transforms while the surrounding text scrolls past. Use sparingly on the homepage product narrative.",
      "Component playground in marketing. Framer shows their components on their marketing site as live, interactive demos. Our verification flow should be a live demo, not a screenshot."
    ],
    caveat: "Framer's marketing is sometimes overcaffeinated — too many gradients, too many moving parts. OKORO uses the same techniques with 30% of the volume."
  },
  {
    rank: 8, name: "Cloudflare",
    tagline: "Helping build a better Internet.",
    why: "Cloudflare is the closest peer in security/edge infrastructure brand category. They sell trust at scale, and their visual language balances technical credibility with broad-market accessibility — exactly OKORO's brief.",
    steal: [
      "Technical product pages that explain mechanism, not just outcome. Cloudflare shows you the network diagram. OKORO should show the verification flow diagram on the homepage.",
      "Dashboard-first product marketing. Their best marketing pages are the dashboard itself. OKORO dashboard screenshots should be a primary marketing asset.",
      "Transparent pricing with tier hard-gates. Cloudflare pricing is famously legible — Free / Pro / Business / Enterprise with clear feature differences.",
      "Open-source SDK as brand. Workers SDK, the 'Build with Cloudflare' positioning. OKORO @okoro/sdk should be similarly central to brand."
    ],
    caveat: "Cloudflare's orange + black is iconic; do not borrow. Their information density also tips into corporate — OKORO keeps more whitespace and editorial restraint."
  },
  {
    rank: 9, name: "Cursor",
    tagline: "The AI code editor.",
    why: "Cursor is the AI-native developer tool whose brand and product feel like one continuous surface. Dark, cinematic, command-palette-driven. They show what an AI infrastructure brand can be when motion and product are designed together.",
    steal: [
      "Cinematic dark product screenshots as marketing. The product itself is the marketing.",
      "Command palette as primary navigation metaphor — Cmd-K everywhere. OKORO dashboard should have the same.",
      "Animated demo loops on the homepage. 6-12 second loops showing the actual product flow, embedded in the hero.",
      "Pricing that's confident — three tiers, clear differentiation, no negotiation theater."
    ],
    caveat: "Cursor's brand voice is sometimes thin (a fork of VSCode + AI). OKORO has a richer story to tell — neutrality, cryptography, the audit log. Lean into our depth."
  },
  {
    rank: 10, name: "Resend",
    tagline: "Email for developers.",
    why: "Resend is the current peak of dev-tool surface design. Their docs, dashboard, and marketing are all rendered with the same surgical type and restraint. They proved a new dev-tool brand can win on craft alone.",
    steal: [
      "Docs as primary marketing surface. Resend's docs are the most-visited page on the site. OKORO docs should be designed with marketing-grade attention.",
      "Mono-tonal palette + one signal color. Resend's entire system is greyscale with one accent. We follow with Halo + Cyan.",
      "Code blocks with breathing room. Padding, line-height, syntax tokens that aren't oversaturated. Our code component should match.",
      "API reference design — left rail with method tree, right rail with code samples. Industry-best."
    ],
    caveat: "Resend is monochrome. OKORO gets the aurora gradient as a single brand signature — more chromatic personality than Resend, less than Stripe."
  },
  {
    rank: 11, name: "Tailscale",
    tagline: "The easiest, most secure way to connect.",
    why: "Tailscale shows that security infrastructure can be friendly. Their illustrations, copy voice, and onboarding warmth dissolve the usual cold-corporate-security tone — without ever feeling unserious.",
    steal: [
      "Friendly copy voice on hard topics. Tailscale explains zero-trust networking like a good colleague would. OKORO explains cryptographic verification with the same patience.",
      "Onboarding that's a delight. The first connection is a celebration. The first verified call from an agent should feel like a milestone in our dashboard.",
      "Customer stories told as essays, not testimonials. We follow with case studies written as 800-word narratives, not pull-quote walls.",
      "Pricing for the underdog tier — generous free tier, hobbyist-friendly. OKORO should have a 10K-verifications/mo free tier."
    ],
    caveat: "Tailscale's illustrations are charming and very on-brand for them. OKORO doesn't do illustrations — our visuals are 3D-rendered marks, network diagrams, and dashboard screenshots."
  },
  {
    rank: 12, name: "Mercury",
    tagline: "Banking for startups.",
    why: "Mercury is the trust-fintech masterclass. Type-led layouts, restrained color, dashboard screenshots as art. They sell the seriousness of money via the seriousness of typography.",
    steal: [
      "Type-led marketing layouts. The headline IS the visual. Less hero imagery, more confident typography.",
      "Dashboard screenshots presented as fine-art prints — chromatic abstractions with a single highlighted UI element.",
      "Customer logos arranged as a typographic frieze, not a logo wall. Higher status.",
      "Trust microcopy: 'FDIC insured up to $5M' — specific, numeric, verifiable. OKORO equivalent: 'Sub-50ms p99 verify. SOC 2 Type II. Audit chain signed.'"
    ],
    caveat: "Mercury's product is regulated banking — they earn the seriousness. OKORO gets there through architectural choices (no private keys, append-only audit) — show the architecture, don't claim regulatory status we don't have."
  }
];

// ---------------------------------------------------------------------------
// Build content
// ---------------------------------------------------------------------------
const cover = [
  new Paragraph({ spacing: { before: 1800, after: 0 }, alignment: AlignmentType.LEFT, children: [
    new TextRun({ text: "OKORO", font: FONT, size: 144, bold: true, color: COLOR.ink, characterSpacing: 200 })
  ]}),
  new Paragraph({ spacing: { before: 80, after: 600 }, children: [
    new TextRun({ text: "Brand & Design System  ·  Version 1.0", font: FONT, size: 28, color: COLOR.fog })
  ]}),
  new Paragraph({ spacing: { before: 0, after: 0 }, children: [
    new TextRun({ text: "Verified light", font: FONT, size: 80, bold: true, color: COLOR.cyan })
  ]}),
  new Paragraph({ spacing: { before: 60, after: 600 }, children: [
    new TextRun({ text: "for autonomous agents.", font: FONT, size: 80, italics: true, color: COLOR.ink })
  ]}),
  rule(),
  new Paragraph({ spacing: { before: 200, after: 80 }, children: [
    new TextRun({ text: "DIRECTION", font: FONT, size: 18, bold: true, color: COLOR.cyan, characterSpacing: 80 })
  ]}),
  new Paragraph({ children: [new TextRun({ text: "Cinematic immersive  ·  Standalone-but-compatible ecosystem strategy", font: FONT, size: 24, color: COLOR.ink })] }),
  new Paragraph({ spacing: { before: 200, after: 80 }, children: [
    new TextRun({ text: "AUTHORED FOR", font: FONT, size: 18, bold: true, color: COLOR.cyan, characterSpacing: 80 })
  ]}),
  new Paragraph({ children: [new TextRun({ text: "Erwin Kiess-Alfonso  ·  Founding operator, OKORO", font: FONT, size: 24, color: COLOR.ink })] }),
  new Paragraph({ spacing: { before: 200, after: 80 }, children: [
    new TextRun({ text: "DELIVERABLES IN /brand", font: FONT, size: 18, bold: true, color: COLOR.cyan, characterSpacing: 80 })
  ]}),
  new Paragraph({ children: [new TextRun({ text: "01_BRAND_BRIEF.docx (this file)  ·  02_design-tokens.json  ·  03_design-tokens.css  ·  04_style-guide.html  ·  logos/*.svg", font: MONO, size: 20, color: COLOR.fog })] }),
];

const sec1Strategy = [
  h1("01  ·  Strategy"),

  eyebrow("Mission"),
  lead("OKORO is the neutral verification, policy enforcement, and behavioral attestation layer between AI agents and the services they act on. We hold only public keys, we sign only what we observed, and we are the Switzerland of agent identity — protocol-, vendor-, and model-neutral."),

  eyebrow("Positioning statement"),
  p("For relying parties (banks, SaaS APIs, internal services) that need to trust autonomous agents acting on their surface,"),
  p("OKORO is the verification and attestation layer"),
  p("that turns agent behavior into a cryptographically signed, auditable record"),
  p("because no agent vendor can be neutral about its own agents,"),
  p("and trust without verification is not trust — it's hope."),

  eyebrow("Brand archetype"),
  p("The Sentinel + The Sage. OKORO is watchful, neutral, illuminating. It is not a guard who challenges you at the gate; it is the credential that let you through to begin with."),

  eyebrow("The three tensions the brand must hold"),
  callout("Tension 01 — Infrastructure vs. emotional",
    "OKORO must read as serious infrastructure (Linear / Vercel / Cloudflare) AND have moments of emotional warmth (Anthropic / Arc / Tailscale). Solution: 90% surgical sans, 10% editorial-serif italics. The serif is the moment we let the brand exhale."),
  callout("Tension 02 — Cryptographic vs. accessible",
    "OKORO speaks Ed25519, EdDSA JWTs, and hash chains. But sales conversations happen with compliance officers and CTOs who want to feel safe, not impressed. Solution: lead with outcomes ('an agent acted, here's the receipt'), back with mechanism ('signed by ed25519:9f3a…')."),
  callout("Tension 03 — Neutral vs. branded",
    "Switzerland is the metaphor — protocol-neutral, vendor-neutral, model-neutral. But neutrality cannot read as bland. Solution: a singular, distinctive aurora gradient as the brand's emotional signature, used as a key light — never as a fill, never replicated by competitors."),

  eyebrow("Audiences (3 personas)"),
  h3("01  ·  The relying-party engineer"),
  p("They build APIs, payment rails, internal services. An agent is calling their endpoint and they need to know it's authorized. They speak HTTP, JWT, OAuth. They want a 5-minute integration."),
  bullet("Surface they live on: the docs."),
  bullet("Decision driver: integration time + verify latency."),
  bullet("Voice: technical, terse, with code samples that compile."),

  h3("02  ·  The agent-platform CTO"),
  p("They build agent products — autonomous workflow tools, AI assistants that take actions. They need a credible third-party trust layer because their customers cannot be expected to take 'trust us' on faith."),
  bullet("Surface they live on: the architecture page + pricing."),
  bullet("Decision driver: defensibility + customer-trust unlock."),
  bullet("Voice: strategic, peer-to-peer, architectural diagrams."),

  h3("03  ·  The compliance officer"),
  p("They sign off on an agent integration touching customer data or money. They speak SOC 2, ISO 27001, audit trails. They cannot evaluate cryptography, but they can evaluate posture."),
  bullet("Surface they live on: the security/trust page."),
  bullet("Decision driver: auditability, append-only logs, sub-processor list."),
  bullet("Voice: precise, conservative, footnoted, certified."),

  eyebrow("Tagline candidates"),
  p("Five directions, in order of preference. Pick one as primary, retain the rest for sub-surface use (footer, sticker, hero alt-state)."),
  number("Verified. Or it didn't happen.  —  Sharpest. Implies cryptographic finality. Best primary."),
  number("Sign once. Verify everywhere.  —  Technical and confident. Best for developer-facing."),
  number("The trust layer for autonomous agents.  —  Most descriptive. Best for compliance."),
  number("Cryptographic ground truth for AI.  —  Most editorial. Best for press and essays."),
  number("Identity. Without the friction.  —  Softest. Best for end-users / consumer surface."),
];

const sec2Benchmarks = [
  h1("02  ·  Benchmark companies"),
  lead("Twelve world-class brands OKORO should study, in order of relevance to our brief. For each: why study them, the specific things to steal, and the things not to copy. The order is not a ranking of brand quality — it's the order in which their lessons matter to us."),
  ...benchmarks.flatMap((b, i) => [
    benchmarkBlock(b),
    ...(i < benchmarks.length - 1 ? [rule()] : [])
  ])
];

const sec3Voice = [
  h1("03  ·  Voice & Tone"),
  lead("OKORO sounds like a senior engineer who has read the spec and is no longer impressed. Calm, technically literal, rarely effusive, never cute. The serif is where we let the human show through."),

  eyebrow("Voice pillars"),
  h3("01  ·  Cryptographic, never magical"),
  p("We don't say 'AI-powered' or 'intelligent verification'. We say 'Ed25519 signature over the canonical request body'. The mechanism is the marketing. If we can't explain how it works, we don't ship it."),
  h3("02  ·  Neutral, not bland"),
  p("OKORO is Switzerland — neutral on agent vendors, neutral on protocols, neutral on models. But neutrality is a stance, not an absence of voice. Our copy is precise, opinionated about how trust works, and unafraid to say what we don't do."),
  h3("03  ·  Technically literal, occasionally human"),
  p("Most copy is technically literal: 'Sub-50ms p99 verify.' Once per page, the editorial serif italic earns the right to be human: 'Trust without verification is not trust — it's hope.'"),
  h3("04  ·  Quiet confidence, not bravado"),
  p("We do not say 'world-class', 'best-in-class', 'enterprise-grade'. We show the architecture. The sentence 'We hold only public keys' is the entire thesis."),

  eyebrow("Microcopy library"),
  inlineMono([
    ["Verified state:  ", false], ["Verified · signed by ed25519:9f3a…c8d2", true]
  ]),
  inlineMono([
    ["Pending state:  ", false], ["Verifying signature… (cached for 60s)", true]
  ]),
  inlineMono([
    ["Denial state:  ", false], ["Denied · SPEND_LIMIT_EXCEEDED · receipt logged", true]
  ]),
  inlineMono([
    ["Empty state:  ", false], ["No agents verified yet. Try the SDK quickstart →", true]
  ]),
  inlineMono([
    ["404 page:  ", false], ["This page wasn't signed. (We don't deal in unverified routes.)", true]
  ]),
  inlineMono([
    ["Onboarding success:  ", false], ["Your first agent is registered. Welcome to the chain.", true]
  ]),

  eyebrow("Do / Don't writing examples"),
  callout("DON'T",
    "\"OKORO leverages cutting-edge cryptography to deliver enterprise-grade trust at scale for the agentic era.\""),
  callout("DO",
    "\"OKORO verifies that an agent did what it claims. Ed25519 signatures, append-only audit. Sub-50ms p99 verify.\""),
  callout("DON'T",
    "\"Powerful AI verification platform with intelligent policy enforcement.\""),
  callout("DO",
    "\"Hold only public keys. Sign only what you observed. Be the Switzerland of agent identity.\""),
];

const sec4Visual = [
  h1("04  ·  Visual identity"),
  lead("Five logo directions explored, one recommended. The mark must work at favicon scale (16px) and hero scale (200px+) without modification. Every mark in this set is geometric — no organic curves, no illustration."),

  h2("Recommended primary  ·  The Okoro Shield"),
  p("Hexagonal shield. The hexagon is geometrically stable and references blockchain (six sides — the structural unit of cryptographic data). A single horizontal line bisects the shield: the audit chain. The negative space at the top of the shield suggests the letter A. A small cyan anchor dot beneath marks the verification point — the moment of truth."),
  p("File: logos/01-shield.svg. Wordmark lockup: logos/wordmark-primary.svg. Stacked lockup: logos/wordmark-stacked.svg."),

  h3("Why this mark wins"),
  bullet("Distinct silhouette at every scale — recognizable from a tab favicon."),
  bullet("Geometrically ownable — no other security/identity company is using this exact hexagon-with-bisector + interior A."),
  bullet("Carries meaning — every element has a reason. Hexagon = stability. Bisector = audit chain. A = OKORO. Anchor = verified point. No decoration."),
  bullet("Works in a single color — the gradient is optional; the silhouette stands alone."),

  h2("Logo usage rules"),
  bullet("Minimum size: 24×24 px for the mark, 96 px width for the wordmark lockup."),
  bullet("Clear space: the height of the inner A, on all four sides."),
  bullet("Backgrounds: prefer Obsidian (#050714) or Ink (#0B1020). On white, the mark reverts to a single Ink-color silhouette — no aurora gradient on light backgrounds."),
  bullet("Never rotate, distort, recolor outside the brand palette, place on a busy photo, or animate the silhouette itself. The aurora stroke may shimmer; the form must not move."),
  bullet("Never combine the mark with another logo without the OKORO team's review (e.g., joint-marketing assets)."),

  h2("Alternates  ·  on file, not in primary use"),
  h3("The Halo  ·  logos/02-halo.svg"),
  p("Most abstract. Reads as pure infrastructure. Best alternate for SDK README, CLI splash screens, and developer-facing surfaces where the shield reads too institutional."),
  h3("The North Star  ·  logos/03-northstar.svg"),
  p("Most editorial. Renders the 'Switzerland of identity' metaphor literally as a compass. Reserved for the About page, founding-thesis essay, and any surface where neutrality is the explicit message."),
  h3("The Lattice  ·  logos/04-lattice.svg"),
  p("Most technical. Hash chain made visual. Use for the Audit module, the API reference home, and a developer-sticker pack. Pairs well with mono type."),
  h3("The Verified Mark  ·  logos/05-verified-mark.svg"),
  p("Most direct. A checkmark whose tail is a key tooth. Reserved as a verification badge motif (e.g., 'Verified by OKORO' inline badge for relying-party UIs that want to display agent verification status to end users)."),

  h2("Iconography principles"),
  p("Custom icon set, 24×24 viewport, 1.5px stroke, rounded caps and joins. No filled icons in primary use — outlined throughout for visual consistency with the shield mark. Single-color (Halo on dark, Ink on light), with optional Cyan accent on the hover state of interactive icons."),
  bullet("Stroke weight: 1.5px at 24px size."),
  bullet("Caps and joins: round."),
  bullet("Optical alignment over geometric alignment — visual centering beats pixel centering."),
  bullet("No micro-detail; no shadows, no gradients on icons themselves."),
];

const sec5Color = [
  h1("05  ·  Color"),
  lead("Verified Light. A near-black canvas. A single beam of cyan-violet light becomes the emotional center of every screen. Every color earns its place; nothing is decorative."),

  h2("The five canvases"),
  p("Five greys from absolute void to the threshold of light. They stack to create depth without shadows."),
  inlineMono([["Obsidian  ", false], ["#050714", true], ["   ·  Page background. The void before light.", false]]),
  inlineMono([["Ink       ", false], ["#0B1020", true], ["   ·  Default surface. Cards, panels, navigation.", false]]),
  inlineMono([["Steel     ", false], ["#161D33", true], ["   ·  Elevated surface. Modals, raised cards.", false]]),
  inlineMono([["Graphite  ", false], ["#1F2740", true], ["   ·  Subtle inset. Code blocks, kbd, secondary chips.", false]]),
  inlineMono([["Mist      ", false], ["#2B3554", true], ["   ·  Borders, dividers, low-emphasis strokes.", false]]),

  h2("The signal — three brand colors"),
  inlineMono([["Okoro Cyan    ", false], ["#5BE0FF", true], ["   ·  Primary brand. Verified state. The trust beacon.", false]]),
  inlineMono([["Okoro Violet  ", false], ["#8B6BFF", true], ["   ·  Cryptographic accent. Proof, identity.", false]]),
  inlineMono([["Magenta       ", false], ["#FF5BD0", true], ["   ·  Aurora terminal. Used only inside the gradient.", false]]),
  p("The aurora gradient — linear-gradient(135deg, #5BE0FF 0%, #8B6BFF 50%, #FF5BD0 100%) — is reserved like a key light. Used once per page, on the hero anchor element only. Never used as a fill, never as a section background."),

  h2("Status — the three verdicts"),
  p("These three colors are bound to OKORO's denial precedence (see docs/SECURITY.md). Verified, Denied, Pending are the only verdict states. There is never a fourth."),
  inlineMono([["Verified  ", false], ["#4CFFA8", true], ["   ·  Success / verified.", false]]),
  inlineMono([["Denied    ", false], ["#FF5470", true], ["   ·  Denial / error.", false]]),
  inlineMono([["Pending   ", false], ["#FFB86B", true], ["   ·  In-flight / verifying / attention.", false]]),

  h2("Text — four levels of speaking volume"),
  inlineMono([["Halo    ", false], ["#F4F6FF", true], ["   ·  Primary text. Default reading color.", false]]),
  inlineMono([["Fog     ", false], ["#A8B0CC", true], ["   ·  Secondary text, descriptions, captions.", false]]),
  inlineMono([["Shadow  ", false], ["#6B7494", true], ["   ·  Tertiary, placeholder, disabled.", false]]),
  inlineMono([["Echo    ", false], ["#3F4869", true], ["   ·  Watermark-tier de-emphasis.", false]]),

  h2("Usage rules"),
  bullet("Never invent off-token colors. If a color isn't in this list, it doesn't exist."),
  bullet("The aurora gradient is the brand's most precious asset — used once per page, always on the page's anchor element (hero CTA, headline, primary mark)."),
  bullet("Status colors are for verdicts only. Never use Verified Green for 'success' generically — it's bound to verification semantics."),
  bullet("On light backgrounds (rare — only for printed media or partner co-branding), the system inverts: Halo becomes Ink, Cyan/Violet darken to print-legible variants (#0E8FA8 / #5B3FBF)."),

  h2("Accessibility"),
  bullet("Halo (#F4F6FF) on Obsidian (#050714) — contrast ratio 18.7:1 (AAA)."),
  bullet("Fog (#A8B0CC) on Obsidian — 9.3:1 (AAA)."),
  bullet("Cyan (#5BE0FF) on Ink (#0B1020) — 11.2:1 (AAA)."),
  bullet("Aurora gradient text — only for headlines (>= 32px). Below 32px, use solid Cyan to maintain contrast."),
  bullet("Focus rings: 2px Cyan, 2px offset. Never invisible."),
];

const sec6Type = [
  h1("06  ·  Typography"),
  lead("Three voices. A tight technical sans for UI. A humane sans for body. An editorial serif for the moments OKORO has to feel human. The serif is the secret weapon — used once per page, always intentional."),

  h2("The stack"),
  inlineMono([["Display  ", false], ["Inter Tight (or Geist) — Inter, system-ui fallback", true]]),
  p("Headlines, navigation, display. Tight, technical, modern. Variable axis lets us tighten letter-spacing aggressively at large sizes."),
  inlineMono([["Body     ", false], ["Inter — system-ui, Segoe UI fallback", true]]),
  p("Body text, UI, all running prose. Industry-standard, broadly available, optimized for screen reading."),
  inlineMono([["Serif    ", false], ["Instrument Serif — Newsreader, Georgia fallback", true]]),
  p("Editorial accents. Italic preferred. Used once per page for emotional headlines. Free Google Font; rendering is consistent across browsers."),
  inlineMono([["Mono     ", false], ["JetBrains Mono — Geist Mono, ui-monospace fallback", true]]),
  p("Code, signatures, agent IDs, anything cryptographic. Mono is part of the brand voice — not just for code blocks. Use mono for technical-detail microcopy (agent IDs, public keys, status verdicts)."),

  h2("Type scale"),
  p("Eleven sizes covering display through caption. Every size has fixed line-height and letter-spacing — never override at the implementation layer."),
  inlineMono([["Display XL  ", false], ["112px / 1.02 / -0.045em / 600", true], ["   Hero only. Once per page.", false]]),
  inlineMono([["Display     ", false], [" 80px / 1.04 / -0.04em / 600", true]]),
  inlineMono([["H1          ", false], [" 56px / 1.08 / -0.03em / 600", true]]),
  inlineMono([["H2          ", false], [" 40px / 1.15 / -0.025em / 600", true]]),
  inlineMono([["H3          ", false], [" 28px / 1.25 / -0.02em / 600", true]]),
  inlineMono([["H4          ", false], [" 22px / 1.30 / -0.015em / 600", true]]),
  inlineMono([["Body Large  ", false], [" 18px / 1.60 / -0.005em / 400", true]]),
  inlineMono([["Body        ", false], [" 16px / 1.60 / 0 / 400", true]]),
  inlineMono([["Body Small  ", false], [" 14px / 1.55 / 0 / 400", true]]),
  inlineMono([["Caption     ", false], [" 12px / 1.40 / 0.02em / 500", true]]),
  inlineMono([["Eyebrow     ", false], [" 11px / 1.20 / 0.16em / 600  UPPERCASE", true]]),

  h2("Pairing rules"),
  bullet("Display + serif italic accent — the hero pattern. Display sets the architectural tone, serif italic delivers the emotional payload. Example: 'Verified light // for autonomous agents.'"),
  bullet("Eyebrow + H2 + Body Large — the section pattern. Used at every section start."),
  bullet("Mono + Body — the technical pattern. Mono carries cryptographic detail inline with body prose."),
  bullet("Never pair body text with Display weight (600) — that's a headline, not body."),
  bullet("Never use the editorial serif more than once per page. Its scarcity is its power."),

  h2("Editorial serif — when to use"),
  bullet("The hero headline tail (italic) — 'verified light, for autonomous agents.'"),
  bullet("Pull-quotes from customers or the founding team."),
  bullet("Section titles in long-form content (essays, customer stories)."),
  bullet("The 404 page. The thank-you page. The moments OKORO exhales."),
  bullet("Never on UI labels, never in dashboard, never in documentation."),
];

const sec7Spatial = [
  h1("07  ·  Spatial, motion, components"),
  lead("Eight-pixel grid. One easing curve. A short list of components. If a new screen needs a new component, the system is wrong — not the screen."),

  h2("The 8pt spatial grid"),
  p("Every dimension is a multiple of 4, preferring multiples of 8. Off-grid spacing is a tell that the system was bypassed."),
  inlineMono([["Tokens:  ", false], ["space-1=4  space-2=8  space-3=12  space-4=16  space-6=24  space-8=32  space-12=48  space-16=64  space-24=96  space-32=128", true]]),
  bullet("Default card padding: space-6 (24px)."),
  bullet("Section vertical rhythm: space-24 (96px) between major sections, space-12 (48px) within."),
  bullet("Container widths: 640 (narrow editorial) / 1120 (default product) / 1320 (marketing wide) / 1536 (full)."),

  h2("Motion language"),
  p("One easing curve does 90% of the work."),
  inlineMono([["The signature ease:  ", false], ["cubic-bezier(0.16, 1, 0.3, 1)", true], ["   ease-out-expo. Apple/Linear-grade.", false]]),
  p("Five durations:"),
  inlineMono([["instant  80ms   ", false], ["hover state changes — must feel free", true]]),
  inlineMono([["fast     160ms  ", false], ["microinteractions — buttons, toggles", true]]),
  inlineMono([["base     240ms  ", false], ["default — most state changes", true]]),
  inlineMono([["slow     480ms  ", false], ["page transitions, large surface moves", true]]),
  inlineMono([["cinema   800ms  ", false], ["cinematic reveals — hero entries, scroll-triggered", true]]),
  bullet("Reveal pattern: opacity 0→1 + translateY(24px → 0). Stagger children by 60ms."),
  bullet("Hover: never tilt. Translate Y by 1-2px and shift shadow elevation up one tier. Subtle is the brand."),
  bullet("Reduced motion: respect prefers-reduced-motion — disable all transitions/animations to 0.01ms."),

  h2("Component patterns"),
  p("These are the only components OKORO ships in v1. They cover ~95% of surfaces."),
  h3("Button — four variants"),
  bullet("Aurora (primary CTA): aurora gradient fill, Obsidian text. Reserved for one CTA per page."),
  bullet("Primary: Halo background, Obsidian text. Default action."),
  bullet("Secondary: Steel background, Halo text, hairline border. Default secondary."),
  bullet("Ghost: transparent, Halo text, hover background. Inline / cancel actions."),
  h3("Card — three variants"),
  bullet("Default: Ink background, elev-1 shadow, Halo text."),
  bullet("Signature: aurora-soft gradient, hairline violet border. Reserved for the page's anchor card."),
  bullet("Inset: Graphite background, no shadow. For nested content (audit log entries, code samples)."),
  h3("Status badge — four variants"),
  bullet("Verified, Denied, Pending — bound to verdict semantics. Pill-shape, mono font, 6px dot prefix."),
  bullet("Signal: cyan-soft background, cyan text. For neutral technical metadata (signature IDs, key fingerprints)."),
  h3("Code block"),
  p("Graphite background, JetBrains Mono, 14px size, 1.6 line-height. Syntax tokens limited to: keyword (Violet), string (Verified), number (Pending), comment (Shadow), brand-signal (Cyan)."),
];

const sec8Pages = [
  h1("08  ·  Page-by-page UX patterns"),
  lead("The pages OKORO must ship in Phase 1. Each entry is a brief: what the page is for, the visual pattern, and the one moment that earns the immersive treatment."),

  h2("Homepage  ·  /"),
  p("Purpose: convince a relying-party engineer to read the docs in 20 seconds."),
  bullet("Hero: aurora-mesh ambient lighting, hero shield mark with subtle float animation, display-XL headline + serif italic tail, single aurora-CTA + secondary docs link."),
  bullet("Section 02 — the proof: a live verify request and signed response, rendered in the code component, with a real signature animating in."),
  bullet("Section 03 — the architecture diagram: SVG, animated. Agent → OKORO → Relying Party. Public key flows separate from the verification path. The diagram IS the marketing."),
  bullet("Section 04 — the denial precedence: visualized as a flow chart. Architecturally honest. Compliance officers will screenshot this."),
  bullet("Section 05 — customer logos as typographic frieze (when we have them)."),
  bullet("Section 06 — pricing teaser → /pricing. Three tiers, hard-gated."),
  bullet("Footer: dense, mono. Sub-processors, security contact, status page link, sister-brand acknowledgement."),
  callout("The cinematic moment", "The hero shield mark, rendered in 3D with the aurora aurora as volumetric light. 60-second silent loop. Commission once, reuse everywhere."),

  h2("Docs  ·  /docs"),
  p("Purpose: get a relying-party engineer integrated in 5 minutes."),
  bullet("Three-pane: left rail (method tree) / center (prose + code) / right rail (live request / response panel)."),
  bullet("Cmd-K palette as primary navigation. Searchable across all docs and code samples."),
  bullet("Code blocks: copy-button, language switcher (TS/Python/curl), syntax highlighting in brand-signal palette."),
  bullet("Inline 'try it' button — sends a real signed verify request from a sandbox key, shows the response inline."),
  callout("The cinematic moment", "The Quickstart page — first 60 seconds of integration. Code blocks animate in as the prose explains. Each block is annotated with response time and audit-log entry. Reads like a guided tour."),

  h2("Dashboard  ·  /app"),
  p("Purpose: an operating console, not a marketing surface. But every screenshot is marketing."),
  bullet("Layout: sidebar (sections) + topbar (principal switcher, cmd-K) + main canvas."),
  bullet("Sections: Agents, Policies, Verify Log, Audit, API Keys, Webhooks, Billing."),
  bullet("Verify Log is the hero view — real-time stream of signed verification events. Each row: timestamp, agent ID, verdict badge, signature fingerprint, expand-for-detail."),
  bullet("Empty states: never blank. Always a quickstart CTA + one example."),
  callout("The cinematic moment", "First 'verified' event after a fresh integration — a one-time animated celebration: aurora glow pulses through the row, success badge animates in. Tasteful, ten frames, under 800ms."),

  h2("Pricing  ·  /pricing"),
  p("Purpose: tier the customer in 30 seconds."),
  bullet("Three tiers, hard-gated — Free / Team / Enterprise. (Operator decision pending — see docs/spec/04_COMMERCIAL_STRATEGY.md.)"),
  bullet("Each tier: one-line description, monthly price, three featured limits (verifications/mo, agents, audit retention), feature comparison below."),
  bullet("Trust microcopy in mono below the fold: 'Sub-50ms p99 verify · Append-only audit · SOC 2 Type II (in progress).'"),

  h2("Security & Trust  ·  /security"),
  p("Purpose: get a compliance officer to sign off."),
  bullet("Lead with the architectural facts: We hold only public keys. We sign only what we observed. Append-only audit log."),
  bullet("Sub-processor list, data-handling diagram, encryption posture."),
  bullet("Denial precedence diagram (same as homepage section 04, but with extended commentary)."),
  bullet("Vulnerability disclosure / security@okoro email."),
  bullet("Editorial serif moment: a one-paragraph essay from the operator on why neutrality is the architecture, not a position."),

  h2("Status  ·  /status"),
  p("Purpose: real-time honesty about uptime."),
  bullet("Three regions, three services (Verify, Audit, Identity). Real-time. No theatrical 'all systems operational' when one isn't."),
  bullet("Incident history, post-mortems linked."),
  bullet("Mono throughout. Quiet. Confident."),

  h2("Audit-log explorer  ·  /app/audit"),
  p("Purpose: prove the chain."),
  bullet("Each event row shows: timestamp, event type, principal, hash chain link to previous, signature."),
  bullet("Hover an event: reveals the canonical bytes that were signed (the literal input to ed25519_sign). Compliance officers will love this."),
  bullet("Export: signed JSON-Lines bundle, with the chain head signature for offline verification."),
];

const sec9Ecosystem = [
  h1("09  ·  Ecosystem strategy"),
  lead("OKORO is positioned as standalone-but-compatible. It has its own gravitational mark and palette. Its type philosophy and motion language harmonize with Anthropic-adjacent products and the future Cerniq lineup, so they can coexist without clashing."),

  h2("Standalone-but-compatible — the rules"),
  bullet("OKORO owns: the hexagonal shield mark, the aurora gradient, the Verified Light palette, the 'Switzerland of agent identity' positioning."),
  bullet("OKORO shares with the broader ecosystem: Inter / Inter Tight / Instrument Serif / JetBrains Mono type stack, the 8pt grid, the cubic-bezier(0.16, 1, 0.3, 1) easing, the dark-canvas convention."),
  bullet("OKORO does not share: its specific palette hexes, its mark, its tagline."),
  bullet("Result: in a portfolio shot, OKORO reads as belonging to a coherent design family, but it is unmistakably its own product."),

  h2("Anthropic adjacency — the rules"),
  p("OKORO lives next door to Anthropic in market category (AI infrastructure, trust). When co-marketing or appearing alongside Anthropic surfaces:"),
  bullet("Type harmony: both use Inter family for sans. Both use editorial serif italic for emotional accents. Visually they cohere."),
  bullet("Color contrast: Anthropic is warm (cream / coral). OKORO is cool (Obsidian / cyan-violet). Side-by-side, they read as complementary categories — warm-creative + cool-infrastructural."),
  bullet("Voice harmony: both speak in restrained, technically literal language. Neither over-promises."),
  bullet("Forbidden: do not put the OKORO shield on a cream Anthropic-style background. The mark is dark-canvas-only."),

  h2("Cerniq sister-brand — the rules"),
  p("OKORO and Cerniq (the operator's other product) should read as sister brands when shown together — same family, different purposes."),
  bullet("Shared spine: type stack, motion curve, 8pt grid, dark-canvas convention."),
  bullet("Distinct signatures: Cerniq has its own palette and mark; OKORO has the aurora and shield. Each brand owns its own gradient direction."),
  bullet("Co-branded surfaces (e.g., a portfolio page): use neutral typographic treatment — 'OKORO · Cerniq · ___' as a typographic frieze, no logo lockup."),

  h2("Sub-product expansion (when OKORO spawns child brands)"),
  p("When OKORO adds named sub-products (e.g., Okoro Audit, Okoro Court, Okoro Policies), follow Stripe's brand architecture pattern."),
  bullet("Naming: 'Okoro [Module]' — never a standalone brand. The parent always comes first."),
  bullet("Mark: the parent shield is the only mark. Sub-products do not get their own logos."),
  bullet("Color: each sub-product gets one accent color drawn from the canvas palette (e.g., Okoro Audit might lead with Steel + Cyan; Okoro Court with Graphite + Violet). Never invent new accents."),
  bullet("Surfaces: sub-products live as sections on the OKORO dashboard, not as separate apps. Marketing is unified at /products."),
];

const sec10Handoff = [
  h1("10  ·  Implementation handoff"),
  lead("This brief is the strategy. The tokens are the law. The HTML is the proof. Hand all four to Claude or a designer; everything below is what to do with them."),

  h2("File index"),
  inlineMono([["/brand/01_BRAND_BRIEF.docx        ", false], ["This file. Strategy and benchmark studies.", true]]),
  inlineMono([["/brand/02_design-tokens.json      ", false], ["W3C-format design tokens. Source of truth.", true]]),
  inlineMono([["/brand/03_design-tokens.css       ", false], ["Same tokens as CSS custom properties.", true]]),
  inlineMono([["/brand/04_style-guide.html        ", false], ["Living visual style guide. Open in browser.", true]]),
  inlineMono([["/brand/logos/01-shield.svg        ", false], ["Recommended primary mark.", true]]),
  inlineMono([["/brand/logos/02-halo.svg          ", false], ["Alternate — infrastructure.", true]]),
  inlineMono([["/brand/logos/03-northstar.svg     ", false], ["Alternate — editorial / mission.", true]]),
  inlineMono([["/brand/logos/04-lattice.svg       ", false], ["Alternate — SDK / docs / sticker.", true]]),
  inlineMono([["/brand/logos/05-verified-mark.svg ", false], ["Verification badge motif.", true]]),
  inlineMono([["/brand/logos/wordmark-primary.svg ", false], ["Horizontal lockup with shield.", true]]),
  inlineMono([["/brand/logos/wordmark-stacked.svg ", false], ["Vertical lockup. Social avatars.", true]]),

  h2("Implementation order"),
  h3("Phase 1  ·  This week"),
  bullet("Drop 03_design-tokens.css into apps/dashboard. Replace any existing color/spacing/type rules. Apply class .okoro-root to the root element."),
  bullet("Replace any existing logo references with logos/01-shield.svg and logos/wordmark-primary.svg. Remove the v0 logo."),
  bullet("Build the homepage hero from scratch using the spec in section 08 of this brief. The hero is the marketing asset that opens every door — start there."),
  bullet("Adopt the four button variants and the three card variants. Audit existing UI; replace any off-token components."),

  h3("Phase 2  ·  Next two weeks"),
  bullet("Build the docs three-pane layout. Adopt the code block component as the primary technical-content surface."),
  bullet("Build the verify-log dashboard view. This is the screenshot that sells OKORO in product demos — invest accordingly."),
  bullet("Commission the 3D-rendered hero shield animation. One asset. 60-second silent loop. Reuse on homepage, social, README."),

  h3("Phase 3  ·  Month two"),
  bullet("Pricing page hard-gates locked (operator decision pending — flagged in CLAUDE.md)."),
  bullet("Security & Trust page with full sub-processor list, denial precedence diagram, vulnerability disclosure flow."),
  bullet("Status page on a separate subdomain (status.okoro.dev or similar)."),
  bullet("Customer-story long-form essay format (when we have a customer)."),

  h2("Open operator decisions"),
  p("These three items are flagged and need your input before some of the brand work above lands fully."),
  bullet("Tagline primary — recommended: 'Verified. Or it didn't happen.' Confirm or veto."),
  bullet("Domain — okoro.dev / okoro.id / agent-okoro.com — this affects logo lockup and word-mark length. Pick one."),
  bullet("3D hero render budget — commission a freelancer (~$3-8K), AI-generate, or skip and ship with the SVG mark animated. Recommendation: commission. The hero animation is the brand's single most replicable asset."),

  h2("Verification checklist before any external surface ships"),
  bullet("Off-token colors? — every hex must be from 02_design-tokens.json."),
  bullet("Off-grid spacing? — every dimension must be a multiple of 4 (preferably 8)."),
  bullet("More than one aurora gradient on the page? — there can be only one."),
  bullet("Editorial serif used more than once on this page? — too much; pull it back."),
  bullet("Reduced-motion respected? — verify with prefers-reduced-motion: reduce."),
  bullet("Focus rings visible on all interactive elements? — keyboard-test it."),
  bullet("Halo on Obsidian contrast verified? — should hit 18:1 by default; never accept below 7:1 anywhere."),

  h2("Closing"),
  p("OKORO is the verification layer between AI agents and the world. It cannot afford to look like another startup. Every surface this brand touches should answer one question: would this make a careful relying-party engineer trust us with their production traffic?"),
  p("If the answer is yes, we have the brand right. If the answer is anything else, we are still drafting."),
];

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
const doc = new Document({
  creator: "OKORO",
  title: "OKORO — Brand & Design System v1.0",
  description: "Master brand brief — cinematic immersive direction, standalone-but-compatible ecosystem strategy.",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 56, bold: true, font: FONT, color: COLOR.ink },
        paragraph: { spacing: { before: 0, after: 280 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: FONT, color: COLOR.ink },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: COLOR.ink },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 360 } } } }
        ]
      },
      { reference: "numbers",
        levels: [
          { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }
        ]
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "OKORO  ·  Brand & Design System v1.0", font: FONT, size: 16, color: COLOR.fog, characterSpacing: 40 })]
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        children: [
          new TextRun({ text: "Verified. Or it didn't happen.", font: FONT, size: 16, color: COLOR.fog, italics: true }),
          new TextRun({ text: "\t", font: FONT }),
          new TextRun({ text: "Page ", font: FONT, size: 16, color: COLOR.fog }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: COLOR.fog })
        ]
      })] })
    },
    children: [
      ...cover,
      ...sec1Strategy,
      ...sec2Benchmarks,
      ...sec3Voice,
      ...sec4Visual,
      ...sec5Color,
      ...sec6Type,
      ...sec7Spatial,
      ...sec8Pages,
      ...sec9Ecosystem,
      ...sec10Handoff
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  const out = path.resolve(__dirname, "../01_BRAND_BRIEF.docx");
  fs.writeFileSync(out, buf);
  console.log("✓ wrote", out, "(", (buf.length / 1024).toFixed(1), "KB )");
}).catch(e => { console.error(e); process.exit(1); });
