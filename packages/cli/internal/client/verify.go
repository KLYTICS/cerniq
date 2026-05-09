package client

import (
	"context"
	"net/http"
)

// Verify wires POST /v1/verify. Uses the verify-only key when one was
// configured via WithVerifyKey, otherwise falls back to the management
// API key (the spec accepts either).
//
// IMPORTANT: a 200 response can still mean valid=false. Callers MUST
// check VerifyResponse.Valid before treating the result as success.
// This matches CLAUDE.md invariant 4 (no fabricated success).
func (c *Client) Verify(ctx context.Context, in *VerifyRequest) (*VerifyResponse, error) {
	req, err := c.reqWithAuth(ctx, http.MethodPost, "/v1/verify", in, authVerify)
	if err != nil {
		return nil, err
	}
	var out VerifyResponse
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}
