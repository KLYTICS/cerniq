package client

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestClient(t *testing.T, h http.Handler) *Client {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	c, err := New(srv.URL, "sk_test_abc123")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func TestAgentsRegister_PostsAndDecodes(t *testing.T) {
	want := AgentRegisterResponse{
		AgentID:           "agt_01HZ",
		VerificationToken: "vt-xxx",
		TrustScore:        500,
		RegisteredAt:      time.Now().UTC().Truncate(time.Second),
	}
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/agents/register" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("X-OKORO-API-Key") != "sk_test_abc123" {
			t.Errorf("missing API key header")
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"runtime":"openai"`) {
			t.Errorf("body missing runtime: %s", body)
		}
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(want)
	}))
	got, err := c.AgentsRegister(context.Background(), &AgentRegisterRequest{
		PublicKey:   "MCowBQYDK2VwAyEA-test",
		Runtime:     RuntimeOpenAI,
		PrincipalID: "prn_01",
		Label:       "test",
	})
	if err != nil {
		t.Fatalf("AgentsRegister: %v", err)
	}
	if got.AgentID != want.AgentID || got.TrustScore != want.TrustScore {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestAgentsStatus_PublicNoAuthHeader(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-OKORO-API-Key") != "" {
			t.Errorf("public endpoint must not send X-OKORO-API-Key")
		}
		_ = json.NewEncoder(w).Encode(AgentStatusResponse{
			AgentID: "agt_01", Status: StatusActive, TrustScore: 720, TrustBand: BandVerified,
		})
	}))
	got, err := c.AgentsStatus(context.Background(), "agt_01")
	if err != nil {
		t.Fatalf("AgentsStatus: %v", err)
	}
	if got.TrustBand != BandVerified {
		t.Errorf("trust band: %s", got.TrustBand)
	}
}

func TestAgentsRevoke_204NoBody(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	if err := c.AgentsRevoke(context.Background(), "agt_01"); err != nil {
		t.Fatalf("AgentsRevoke: %v", err)
	}
}

func TestAgentsRevoke_404Surfaced(t *testing.T) {
	c := newTestClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"code":"AGENT_NOT_FOUND","message":"no such agent"}}`))
	}))
	err := c.AgentsRevoke(context.Background(), "agt_missing")
	if err == nil {
		t.Fatal("expected error for 404")
	}
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %T", err)
	}
	if apiErr.Code != "AGENT_NOT_FOUND" {
		t.Errorf("code: %s", apiErr.Code)
	}
}

func TestAgentsRegister_RejectsEmptyAgentID(t *testing.T) {
	c, _ := New("https://example.test", "k")
	if _, err := c.AgentsGet(context.Background(), ""); err == nil {
		t.Error("expected error for empty agentID")
	}
}
