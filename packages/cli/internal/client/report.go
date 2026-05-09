package client

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// Report wires POST /v1/agents/{agentId}/report. Returns nil on the
// 202 Accepted response — reports are processed async, so a 200/202
// only confirms the signal was queued, not that BATE has scored it.
func (c *Client) Report(ctx context.Context, agentID string, in *ReportRequest) error {
	if agentID == "" {
		return fmt.Errorf("agentID required")
	}
	if in == nil || in.EventType == "" {
		return fmt.Errorf("eventType required")
	}
	req, err := c.req(ctx, http.MethodPost,
		"/v1/agents/"+url.PathEscape(agentID)+"/report", in)
	if err != nil {
		return err
	}
	return c.do(req, nil)
}
