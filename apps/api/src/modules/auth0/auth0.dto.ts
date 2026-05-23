// DTOs for the Auth0 module. The Auth0 Action posts to `/v1/idp/auth0/login`
// for CERNIQ-side audit + principal binding. The dashboard posts to
// `/v1/idp/auth0/exchange` to swap an Auth0 access token for an CERNIQ
// API session.

export interface Auth0ActionLoginDto {
  /** Auth0 user `sub`. */
  user_id: string;
  /** Auth0 Organization id (from `org_id` custom claim or root `organization`). */
  organization_id: string;
  email: string;
  email_verified: boolean;
  /** Whether MFA was satisfied this session. From `amr` array. */
  mfa: boolean;
  /** Roles CERNIQ expects: `cerniq:admin`, `cerniq:operator`, `cerniq:viewer`. */
  roles: string[];
  /** When this login completed (Auth0 server clock). */
  occurred_at: string;
  /** ip + user agent — straight to audit log, NEVER stored in Principal. */
  ip: string;
  user_agent: string;
}

export interface Auth0ActionLoginResultDto {
  principal_id: string;
  /** True if this login created a new Principal. Action surfaces in monitoring. */
  principal_created: boolean;
  /** Audit event id; the Action logs it for cross-reference. */
  audit_event_id: string;
}

export interface Auth0ExchangeDto {
  /** Bearer access token issued by Auth0. */
  access_token: string;
}

export interface Auth0ExchangeResultDto {
  /** The CERNIQ API key the dashboard uses for subsequent requests. */
  api_key_id: string;
  /** The CERNIQ Principal this human is operating within. */
  principal_id: string;
  /** CERNIQ roles parsed from Auth0 custom claims. */
  roles: string[];
  /** When the API key expires. Refresh via re-exchange. */
  expires_at: string;
}
