// OKORO — production-grade Helmet configuration.
//
// `app.use(helmet())` with defaults is good but not enough for an
// identity gateway that publishes verifiable cryptographic material at
// well-known URLs. We tighten:
//
//   - HSTS: includeSubDomains + preload + 2-year max-age (HSTS preload
//     list eligibility requires 1 year minimum; 2 years is industry standard).
//   - CSP: default-src 'none' for all API responses (we serve no HTML
//     except Swagger; Swagger gets its own relaxed policy in Swagger setup).
//   - frameguard: deny (we never embed anything in iframes).
//   - referrerPolicy: no-referrer (don't leak target URLs in API call
//     contexts; default `strict-origin-when-cross-origin` is too lax).
//   - crossOriginResourcePolicy: same-site (the verify endpoint is wide
//     open via CORS allow-list, but resources should not be embeddable).
//   - permittedCrossDomainPolicies: none (legacy Flash; off).
//   - x-powered-by: removed (don't advertise Express).
//
// Production reference: https://hstspreload.org/ — domains we publish on
// (api.okorolabs.io) get added to the preload list once HSTS rolls out.

import type { HelmetOptions } from 'helmet';

export interface HelmetConfig {
  /** Set false for local development to allow http://localhost. */
  enableHsts: boolean;
  /** Operator's contact endpoint for security.txt — RFC 9116 has this as a SHOULD. */
  securityContactUrl?: string;
}

export function buildHelmetConfig(config: HelmetConfig): HelmetOptions {
  return {
    // Hide the Express signature.
    hidePoweredBy: true,

    // HSTS — only when serving over HTTPS in production.
    strictTransportSecurity: config.enableHsts
      ? {
          maxAge: 63_072_000, // 2 years
          includeSubDomains: true,
          preload: true,
        }
      : false,

    // CSP — API responses are JSON; reject every other source.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        // Swagger UI overrides this in its own setup() call when enabled.
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },

    // No iframes anywhere.
    frameguard: { action: 'deny' },

    // Don't leak Referer to upstream / downstream.
    referrerPolicy: { policy: 'no-referrer' },

    // Resources cross-origin? No — the verify endpoint is JSON-over-CORS,
    // not a fetched resource.
    crossOriginResourcePolicy: { policy: 'same-site' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false, // off — no embedded resources to attest

    // Legacy mitigations.
    xssFilter: false, // deprecated header; CSP is the right answer
    ieNoOpen: true,
    noSniff: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    dnsPrefetchControl: { allow: false },

    // Origin-Agent-Cluster: yes, we want process isolation in browsers.
    originAgentCluster: true,
  };
}

/**
 * RFC 9116 security.txt content. Mounted at /.well-known/security.txt.
 * Tells researchers how to report findings without scanning for an
 * undocumented contact.
 */
export function buildSecurityTxt(config: { contactEmail: string; preferredLanguages?: string }): string {
  const lines = [
    `Contact: mailto:${config.contactEmail}`,
    `Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}`,
    `Preferred-Languages: ${config.preferredLanguages ?? 'en'}`,
    `Canonical: https://api.okorolabs.io/.well-known/security.txt`,
    `Policy: https://okorolabs.io/security/policy`,
    `Acknowledgments: https://okorolabs.io/security/acknowledgments`,
  ];
  return lines.join('\n') + '\n';
}
