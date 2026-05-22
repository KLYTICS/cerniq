package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVerify_PrefersVerifyKeyHeader(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-OKORO-Verify-Key"); got != "vk_relying_party" {
			t.Errorf("X-OKORO-Verify-Key: %q", got)
		}
		if got := r.Header.Get("X-OKORO-API-Key"); got != "" {
			t.Errorf("X-OKORO-API-Key set when verify key present: %q", got)
		}
		_ = json.NewEncoder(w).Encode(VerifyResponse{
			Valid:      true,
			AgentID:    "agt_01",
			TrustScore: 800,
			TrustBand:  BandVerified,
		})
	}))
	t.Cleanup(srv.Close)
	c, err := New(srv.URL, "sk_management", WithVerifyKey("vk_relying_party"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	got, err := c.Verify(context.Background(), &VerifyRequest{Token: "abc"})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if !got.Valid {
		t.Error("Valid: false")
	}
}

func TestVerify_FallsBackToAPIKeyWhenNoVerifyKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-OKORO-API-Key"); got != "sk_management" {
			t.Errorf("X-OKORO-API-Key fallback missing: %q", got)
		}
		_ = json.NewEncoder(w).Encode(VerifyResponse{Valid: false})
	}))
	t.Cleanup(srv.Close)
	c, _ := New(srv.URL, "sk_management")
	if _, err := c.Verify(context.Background(), &VerifyRequest{Token: "abc"}); err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

func TestVerify_DenialReasonRoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"valid":false,"agentId":"agt","trustScore":120,"trustBand":"FLAGGED","denialReason":"TRUST_SCORE_TOO_LOW","verifiedAt":"2026-05-02T12:00:00Z","ttl":30}`))
	}))
	t.Cleanup(srv.Close)
	c, _ := New(srv.URL, "k")
	got, err := c.Verify(context.Background(), &VerifyRequest{Token: "x"})
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if got.DenialReason == nil || *got.DenialReason != DenialTrustScoreTooLow {
		t.Errorf("denial reason: %v", got.DenialReason)
	}
}
