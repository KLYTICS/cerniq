package client

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
)

// EventsList wires GET /v1/agents/{agentId}/audit. Cursor-based
// pagination — passing the previous response's NextCursor advances
// the window. Empty NextCursor means "caller is at the chain head".
func (c *Client) EventsList(ctx context.Context, agentID string, q AuditQuery) (*AuditLogResponse, error) {
	if agentID == "" {
		return nil, fmt.Errorf("agentID required")
	}
	values := url.Values{}
	if q.From != nil {
		values.Set("from", q.From.UTC().Format("2006-01-02T15:04:05Z07:00"))
	}
	if q.To != nil {
		values.Set("to", q.To.UTC().Format("2006-01-02T15:04:05Z07:00"))
	}
	if q.Limit > 0 {
		values.Set("limit", strconv.Itoa(q.Limit))
	}
	if q.Cursor != "" {
		values.Set("cursor", q.Cursor)
	}
	path := "/v1/agents/" + url.PathEscape(agentID) + "/audit"
	if encoded := values.Encode(); encoded != "" {
		path += "?" + encoded
	}
	req, err := c.req(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	var out AuditLogResponse
	if err := c.do(req, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// EventsExport streams GET /v1/agents/{agentId}/audit/export.ndjson into
// the supplied writer. The body is NDJSON: one AuditEvent per line. We
// don't buffer in memory — large exports can run for minutes and would
// otherwise exhaust process RAM.
func (c *Client) EventsExport(ctx context.Context, agentID string, w io.Writer) error {
	if agentID == "" {
		return fmt.Errorf("agentID required")
	}
	req, err := c.req(ctx, http.MethodGet,
		"/v1/agents/"+url.PathEscape(agentID)+"/audit/export.ndjson", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/x-ndjson")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("transport: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 {
		// Surface io.ReadAll errors on the audit path so the operator
		// sees a degraded-body condition rather than a misleadingly-
		// truncated APIError. CLAUDE.md invariant #4 — every
		// downstream failure must be visible on audit-export paths.
		body, rerr := io.ReadAll(resp.Body)
		if rerr != nil {
			return fmt.Errorf("read error body for status %d: %w", resp.StatusCode, rerr)
		}
		return parseAPIError(resp.StatusCode, body)
	}
	if _, err := io.Copy(w, resp.Body); err != nil {
		return fmt.Errorf("stream export: %w", err)
	}
	return nil
}
