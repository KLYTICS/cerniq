package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// AgentsRegister wires POST /v1/agents/register. The caller supplies a
// base64url-encoded Ed25519 public key — OKORO never sees the private
// half (CLAUDE.md invariant 1).
func (c *Client) AgentsRegister(ctx context.Context, in *AgentRegisterRequest) (*AgentRegisterResponse, error) {
	req, err := c.req(ctx, http.MethodPost, "/v1/agents/register", in)
	if err != nil {
		return nil, err
	}
	var out AgentRegisterResponse
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// AgentsGet wires GET /v1/agents/{agentId}.
func (c *Client) AgentsGet(ctx context.Context, agentID string) (*AgentIdentity, error) {
	if agentID == "" {
		return nil, fmt.Errorf("agentID required")
	}
	req, err := c.req(ctx, http.MethodGet, "/v1/agents/"+url.PathEscape(agentID), nil)
	if err != nil {
		return nil, err
	}
	var out AgentIdentity
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// AgentsStatus wires GET /v1/agents/{agentId}/status. This is a public
// endpoint per the spec — no API key required.
func (c *Client) AgentsStatus(ctx context.Context, agentID string) (*AgentStatusResponse, error) {
	if agentID == "" {
		return nil, fmt.Errorf("agentID required")
	}
	req, err := c.reqWithAuth(ctx, http.MethodGet, "/v1/agents/"+url.PathEscape(agentID)+"/status", nil, authNone)
	if err != nil {
		return nil, err
	}
	var out AgentStatusResponse
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// AgentsRevoke wires DELETE /v1/agents/{agentId}. Permanent and
// idempotent — a missing agent surfaces as a 404 APIError.
func (c *Client) AgentsRevoke(ctx context.Context, agentID string) error {
	if agentID == "" {
		return fmt.Errorf("agentID required")
	}
	req, err := c.req(ctx, http.MethodDelete, "/v1/agents/"+url.PathEscape(agentID), nil)
	if err != nil {
		return err
	}
	return c.do(req, nil)
}
