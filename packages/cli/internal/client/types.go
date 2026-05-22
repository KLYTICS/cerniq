// Package client wire types — projections of the OKORO API spec at
// docs/spec/OKORO_API_SPEC.yaml. Hand-rolled rather than generated:
// at 8 endpoints the maintenance burden of a code-gen step in the
// install path (`go install …@latest`) outweighs the value. If the
// surface grows past ~20 endpoints, switch to oapi-codegen — the
// per-endpoint methods in agents.go / policies.go / verify.go /
// audit.go / report.go are designed to map 1:1 onto its output.
//
//go:generate echo "regen plan: oapi-codegen -package api -generate types,client -o internal/api/api.gen.go ../../docs/spec/OKORO_API_SPEC.yaml"
package client

import "time"

// AgentRuntime mirrors AgentRegistrationRequest.runtime.
type AgentRuntime string

const (
	RuntimeOpenAI    AgentRuntime = "openai"
	RuntimeAnthropic AgentRuntime = "anthropic"
	RuntimeGoogle    AgentRuntime = "google"
	RuntimeCustom    AgentRuntime = "custom"
)

// AgentStatusKind mirrors AgentIdentity.status.
type AgentStatusKind string

const (
	StatusActive    AgentStatusKind = "active"
	StatusSuspended AgentStatusKind = "suspended"
	StatusRevoked   AgentStatusKind = "revoked"
)

// TrustBand mirrors AgentIdentity.trustBand.
type TrustBand string

const (
	BandPlatinum TrustBand = "PLATINUM"
	BandVerified TrustBand = "VERIFIED"
	BandWatch    TrustBand = "WATCH"
	BandFlagged  TrustBand = "FLAGGED"
)

// DenialReason is the closed set of denial codes.
//
// Order is the CANONICAL precedence from CLAUDE.md invariant 6 — relying
// parties code against this order. The OpenAPI enum at spec line 572-581
// is alphabetical and disagrees with the canonical order; this constant
// list is the source of truth for the CLI renderer.
type DenialReason string

const (
	DenialAgentNotFound      DenialReason = "AGENT_NOT_FOUND"
	DenialAgentRevoked       DenialReason = "AGENT_REVOKED"
	DenialInvalidSignature   DenialReason = "INVALID_SIGNATURE"
	DenialPolicyRevoked      DenialReason = "POLICY_REVOKED"
	DenialPolicyExpired      DenialReason = "POLICY_EXPIRED"
	DenialScopeNotGranted    DenialReason = "SCOPE_NOT_GRANTED"
	DenialSpendLimitExceeded DenialReason = "SPEND_LIMIT_EXCEEDED"
	DenialTrustScoreTooLow   DenialReason = "TRUST_SCORE_TOO_LOW"
	DenialAnomalyFlagged     DenialReason = "ANOMALY_FLAGGED"
)

// CanonicalDenialOrder is the fixed precedence the CLI renders against.
var CanonicalDenialOrder = [...]DenialReason{
	DenialAgentNotFound,
	DenialAgentRevoked,
	DenialInvalidSignature,
	DenialPolicyRevoked,
	DenialPolicyExpired,
	DenialScopeNotGranted,
	DenialSpendLimitExceeded,
	DenialTrustScoreTooLow,
	DenialAnomalyFlagged,
}

// AgentRegisterRequest = AgentRegistrationRequest.
type AgentRegisterRequest struct {
	PublicKey   string       `json:"publicKey"`
	Runtime     AgentRuntime `json:"runtime"`
	Model       string       `json:"model,omitempty"`
	PrincipalID string       `json:"principalId"`
	Label       string       `json:"label,omitempty"`
}

// AgentRegisterResponse = AgentRegistrationResponse.
type AgentRegisterResponse struct {
	AgentID           string    `json:"agentId"`
	VerificationToken string    `json:"verificationToken"`
	TrustScore        int       `json:"trustScore"`
	RegisteredAt      time.Time `json:"registeredAt"`
}

// AgentIdentity is the GET /agents/{id} response.
type AgentIdentity struct {
	AgentID      string          `json:"agentId"`
	PublicKey    string          `json:"publicKey"`
	PrincipalID  string          `json:"principalId"`
	Runtime      AgentRuntime    `json:"runtime"`
	Model        string          `json:"model,omitempty"`
	Label        string          `json:"label,omitempty"`
	Status       AgentStatusKind `json:"status"`
	TrustScore   int             `json:"trustScore"`
	TrustBand    TrustBand       `json:"trustBand"`
	RegisteredAt time.Time       `json:"registeredAt"`
	LastSeenAt   *time.Time      `json:"lastSeenAt,omitempty"`
}

// AgentStatusResponse is GET /agents/{id}/status (public endpoint).
type AgentStatusResponse struct {
	AgentID    string          `json:"agentId"`
	Status     AgentStatusKind `json:"status"`
	TrustScore int             `json:"trustScore"`
	TrustBand  TrustBand       `json:"trustBand"`
	LastSeenAt *time.Time      `json:"lastSeenAt,omitempty"`
}

// PolicyScopeCategory is the closed enum.
type PolicyScopeCategory string

const (
	ScopeCommerce      PolicyScopeCategory = "commerce"
	ScopeDataRead      PolicyScopeCategory = "data-read"
	ScopeDataWrite     PolicyScopeCategory = "data-write"
	ScopeCommunication PolicyScopeCategory = "communication"
	ScopeScheduling    PolicyScopeCategory = "scheduling"
)

// PolicySpendLimit mirrors PolicyScope.spendLimit.
type PolicySpendLimit struct {
	Currency          string  `json:"currency"`
	MaxPerTransaction float64 `json:"maxPerTransaction,omitempty"`
	MaxPerDay         float64 `json:"maxPerDay,omitempty"`
	MaxPerMonth       float64 `json:"maxPerMonth,omitempty"`
}

// PolicyScope mirrors components.schemas.PolicyScope.
type PolicyScope struct {
	Category           PolicyScopeCategory `json:"category"`
	SpendLimit         *PolicySpendLimit   `json:"spendLimit,omitempty"`
	MerchantCategories []string            `json:"merchantCategories,omitempty"`
	AllowedDomains     []string            `json:"allowedDomains,omitempty"`
	DataScopes         []string            `json:"dataScopes,omitempty"`
	ValidFrom          *time.Time          `json:"validFrom,omitempty"`
	ValidUntil         *time.Time          `json:"validUntil,omitempty"`
}

// PolicyCreateRequest = PolicyCreateRequest.
type PolicyCreateRequest struct {
	Scopes    []PolicyScope `json:"scopes"`
	ExpiresAt time.Time     `json:"expiresAt"`
	Label     string        `json:"label,omitempty"`
}

// PolicyCreateResponse = PolicyCreateResponse.
type PolicyCreateResponse struct {
	PolicyID    string    `json:"policyId"`
	SignedToken string    `json:"signedToken"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

// AgentPolicy mirrors AgentPolicy.
type AgentPolicy struct {
	PolicyID  string        `json:"policyId"`
	AgentID   string        `json:"agentId"`
	Scopes    []PolicyScope `json:"scopes"`
	Status    string        `json:"status"`
	CreatedAt time.Time     `json:"createdAt"`
	ExpiresAt time.Time     `json:"expiresAt"`
}

// VerifyRequest = VerifyRequest.
type VerifyRequest struct {
	Token          string         `json:"token"`
	Action         string         `json:"action,omitempty"`
	Amount         float64        `json:"amount,omitempty"`
	Currency       string         `json:"currency,omitempty"`
	MerchantID     string         `json:"merchantId,omitempty"`
	MerchantDomain string         `json:"merchantDomain,omitempty"`
	Context        map[string]any `json:"context,omitempty"`
}

// VerifyResponse = VerifyResponse. DenialReason is nullable in spec.
type VerifyResponse struct {
	Valid          bool          `json:"valid"`
	AgentID        string        `json:"agentId"`
	PrincipalID    string        `json:"principalId"`
	TrustScore     int           `json:"trustScore"`
	TrustBand      TrustBand     `json:"trustBand"`
	ScopesGranted  []string      `json:"scopesGranted,omitempty"`
	SpendRemaining *SpendSummary `json:"spendRemaining,omitempty"`
	DenialReason   *DenialReason `json:"denialReason,omitempty"`
	VerifiedAt     time.Time     `json:"verifiedAt"`
	TTL            int           `json:"ttl"`
}

// SpendSummary mirrors VerifyResponse.spendRemaining.
type SpendSummary struct {
	Today     float64 `json:"today"`
	ThisMonth float64 `json:"thisMonth"`
}

// AuditEvent mirrors AuditEvent.
type AuditEvent struct {
	EventID           string    `json:"eventId"`
	AgentID           string    `json:"agentId"`
	PrincipalID       string    `json:"principalId"`
	Timestamp         time.Time `json:"timestamp"`
	Action            string    `json:"action"`
	RelyingParty      string    `json:"relyingParty,omitempty"`
	Decision          string    `json:"decision"`
	DecisionReason    string    `json:"decisionReason,omitempty"`
	TrustScoreAtEvent int       `json:"trustScoreAtEvent"`
	Signature         string    `json:"signature"`
}

// AuditLogResponse mirrors AuditLogResponse.
type AuditLogResponse struct {
	Events     []AuditEvent `json:"events"`
	NextCursor string       `json:"nextCursor,omitempty"`
	Total      int          `json:"total"`
}

// AuditQuery is the closed set of /audit query params.
type AuditQuery struct {
	From   *time.Time
	To     *time.Time
	Limit  int
	Cursor string
}

// ReportEventType is the closed enum.
type ReportEventType string

const (
	ReportFraudConfirmed     ReportEventType = "fraud_confirmed"
	ReportAnomaly            ReportEventType = "anomaly"
	ReportPolicyViolation    ReportEventType = "policy_violation"
	ReportSuspiciousBehavior ReportEventType = "suspicious_behavior"
	ReportFalsePositive      ReportEventType = "false_positive"
)

// ReportSeverity is the closed enum.
type ReportSeverity string

const (
	SeverityLow      ReportSeverity = "low"
	SeverityMedium   ReportSeverity = "medium"
	SeverityHigh     ReportSeverity = "high"
	SeverityCritical ReportSeverity = "critical"
)

// ReportRequest = ReportRequest.
type ReportRequest struct {
	EventType     ReportEventType `json:"eventType"`
	Severity      ReportSeverity  `json:"severity,omitempty"`
	Description   string          `json:"description,omitempty"`
	TransactionID string          `json:"transactionId,omitempty"`
	Evidence      map[string]any  `json:"evidence,omitempty"`
}
