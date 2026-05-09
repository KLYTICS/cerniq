package client

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestEventsList_CursorPropagated(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("cursor"); got != "evt_99" {
			t.Errorf("cursor not forwarded: %q", got)
		}
		if got := r.URL.Query().Get("limit"); got != "50" {
			t.Errorf("limit not forwarded: %q", got)
		}
		_ = json.NewEncoder(w).Encode(AuditLogResponse{
			Events:     []AuditEvent{{EventID: "evt_100", Timestamp: time.Now().UTC()}},
			NextCursor: "evt_100",
			Total:      1,
		})
	}))
	t.Cleanup(srv.Close)
	c, _ := New(srv.URL, "k")
	got, err := c.EventsList(context.Background(), "agt_01", AuditQuery{Cursor: "evt_99", Limit: 50})
	if err != nil {
		t.Fatalf("EventsList: %v", err)
	}
	if got.NextCursor != "evt_100" {
		t.Errorf("nextCursor: %q", got.NextCursor)
	}
}

func TestEventsExport_StreamsToWriter(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/x-ndjson")
		_, _ = w.Write([]byte(`{"eventId":"e1"}` + "\n" + `{"eventId":"e2"}` + "\n"))
	}))
	t.Cleanup(srv.Close)
	c, _ := New(srv.URL, "k")
	var buf bytes.Buffer
	if err := c.EventsExport(context.Background(), "agt_01", &buf); err != nil {
		t.Fatalf("EventsExport: %v", err)
	}
	if !strings.Contains(buf.String(), `"eventId":"e1"`) || !strings.Contains(buf.String(), `"eventId":"e2"`) {
		t.Errorf("export body unexpected: %q", buf.String())
	}
}

func TestEventsExport_4xxSurfacedAsAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":"PRINCIPAL_FORBIDDEN","message":"export disabled on free tier"}}`))
	}))
	t.Cleanup(srv.Close)
	c, _ := New(srv.URL, "k")
	var buf bytes.Buffer
	err := c.EventsExport(context.Background(), "agt_01", &buf)
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "PRINCIPAL_FORBIDDEN") {
		t.Errorf("error did not surface code: %v", err)
	}
}
