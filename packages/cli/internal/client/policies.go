package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// PoliciesCreate wires POST /v1/agents/{agentId}/policies.
func (c *Client) PoliciesCreate(ctx context.Context, agentID string, in *PolicyCreateRequest) (*PolicyCreateResponse, error) {
	if agentID == "" {
		return nil, fmt.Errorf("agentID required")
	}
	req, err := c.req(ctx, http.MethodPost, "/v1/agents/"+url.PathEscape(agentID)+"/policies", in)
	if err != nil {
		return nil, err
	}
	var out PolicyCreateResponse
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PoliciesList wires GET /v1/agents/{agentId}/policies.
func (c *Client) PoliciesList(ctx context.Context, agentID string) ([]AgentPolicy, error) {
	if agentID == "" {
		return nil, fmt.Errorf("agentID required")
	}
	req, err := c.req(ctx, http.MethodGet, "/v1/agents/"+url.PathEscape(agentID)+"/policies", nil)
	if err != nil {
		return nil, err
	}
	var out []AgentPolicy
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// PoliciesRevoke wires DELETE /v1/agents/{agentId}/policies/{policyId}.
func (c *Client) PoliciesRevoke(ctx context.Context, agentID, policyID string) error {
	if agentID == "" || policyID == "" {
		return fmt.Errorf("agentID and policyID required")
	}
	req, err := c.req(ctx, http.MethodDelete,
		"/v1/agents/"+url.PathEscape(agentID)+"/policies/"+url.PathEscape(policyID), nil)
	if err != nil {
		return err
	}
	return c.do(req, nil)
}
