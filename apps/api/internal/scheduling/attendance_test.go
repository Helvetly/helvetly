package scheduling

import (
	"context"
	"net/http"
	"testing"
	"time"

	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoices"
	"helvetly.com/api/internal/store"
)

type engagementView struct {
	Data struct {
		ID            string `json:"id"`
		CurrentPeriod struct {
			ID   string `json:"id"`
			Used string `json:"used"`
		} `json:"current_period"`
	} `json:"data"`
}

func (e *env) engagement(b *browser, clientID string) string {
	e.t.Helper()
	var out engagementView
	e.do(b, "POST", "/api/v1/engagements", map[string]any{"client_id": clientID, "title": "German", "quantity": "10", "unit_price": "100",
		"unit": "hour", "start_date": "2026-11-01", "recurrence": "monthly", "vat_category": "Z"}, http.StatusCreated, &out)
	return out.Data.ID
}

func (e *env) used(b *browser, engagementID string) string {
	e.t.Helper()
	var out engagementView
	e.do(b, "GET", "/api/v1/engagements/"+engagementID, nil, http.StatusOK, &out)
	return out.Data.CurrentPeriod.Used
}

func TestAttendanceCountsThroughEngagement(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	eng := e.engagement(b, c)
	// Monday 16 Nov 08:00 in Zurich, 90 minutes: an hour unit uses 1.5.
	o := e.create(b, map[string]any{"client_id": c, "engagement_id": eng, "starts_local": "2026-11-16T08:00", "duration_minutes": 90}).Data.Occurrences[0]
	if o.Title != "German" {
		t.Fatalf("title defaults to the engagement's: %q", o.Title)
	}
	att := func(body map[string]any, want int) Occurrence {
		var out struct{ Data Occurrence }
		e.do(b, "POST", "/api/v1/scheduling/occurrences/"+o.ID+"/attendance", body, want, &out)
		return out.Data
	}
	got := att(map[string]any{"status": "attended"}, 200)
	if !got.Counts || len(got.EntryIDs) != 1 || e.used(b, eng) != "1.5" {
		t.Fatalf("attended logs 1.5 h: %+v used %s", got, e.used(b, eng))
	}
	got = att(map[string]any{"status": "no_show"}, 200)
	if !got.Counts || !got.Late || len(got.EntryIDs) != 1 || got.EntryIDs[0] == "" || e.used(b, eng) != "1.5" {
		t.Fatalf("no-show counts by default, one entry: %+v", got)
	}
	got = att(map[string]any{"waive": true, "reason": "Ill"}, 200)
	if got.Counts || got.Waived == nil || got.Waived.By.ID != b.user || len(got.EntryIDs) != 0 || e.used(b, eng) != "0" {
		t.Fatalf("waived: %+v used %s", got, e.used(b, eng))
	}
	got = att(map[string]any{"status": "scheduled"}, 200)
	if got.Counts || got.Status != "scheduled" || got.Waived != nil {
		t.Fatalf("undo: %+v", got)
	}
	got = att(map[string]any{"status": "attended"}, 200)

	// An invoiced entry cannot be taken back.
	ctx := context.Background()
	err := e.st.Tx(ctx, func(q store.Q) error {
		id, err := invoices.New(e.st, nil, nil, nil, nil).CreateDraft(ctx, q, store.Session{Workspace: e.ws(b)}, c, func(inv *store.Invoice) {
			inv.Lines = []store.InvoiceLine{{Description: "Hours", Quantity: 1500, UnitPrice: 10000, VATCategory: "Z"}}
		})
		if err != nil {
			return err
		}
		return q.LinkEntries(ctx, got.EntryIDs, []invoicecalc.Quantity{1500}, id)
	})
	if err != nil {
		t.Fatal(err)
	}
	e.fails(b, "POST", "/api/v1/scheduling/occurrences/"+o.ID+"/attendance", map[string]any{"status": "scheduled"}, 409, "entry_invoiced")

	// Not before the start; waive only by owners and admins; counting needs write:engagements.
	future := e.create(b, map[string]any{"client_id": c, "engagement_id": eng, "starts_local": "2026-11-20T08:00", "duration_minutes": 60}).Data.Occurrences[0]
	e.fails(b, "POST", "/api/v1/scheduling/occurrences/"+future.ID+"/attendance", map[string]any{"status": "attended"}, 409, "not_started")
	member := e.join(b.workspace, "member", []string{"read:scheduling", "write:scheduling"})
	e.fails(member, "POST", "/api/v1/scheduling/occurrences/"+o.ID+"/attendance", map[string]any{"waive": true}, 403, "forbidden")
	past := e.create(b, map[string]any{"client_id": c, "engagement_id": eng, "starts_local": "2026-11-16T06:00", "duration_minutes": 60}).Data.Occurrences[0]
	e.fails(member, "POST", "/api/v1/scheduling/occurrences/"+past.ID+"/attendance", map[string]any{"status": "attended"}, 403, "forbidden")
}

func TestInvoiceSessionsWithoutEngagement(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "")
	body := map[string]any{"client_id": c, "title": "Coaching", "starts_local": "2026-11-16T07:00", "duration_minutes": 60, "unit_price": "120.00", "currency": "CHF"}
	a := e.create(b, body).Data.Occurrences[0]
	body["starts_local"] = "2026-11-16T08:00"
	x := e.create(b, body).Data.Occurrences[0]
	e.fails(b, "POST", "/api/v1/scheduling/occurrences/invoice", map[string]any{"occurrence_ids": []string{a.ID}}, 409, "not_billable")
	for _, id := range []string{a.ID, x.ID} {
		e.do(b, "POST", "/api/v1/scheduling/occurrences/"+id+"/attendance", map[string]any{"status": "attended"}, 200, nil)
	}
	var out struct {
		Data struct {
			InvoiceIDs []string `json:"invoice_ids"`
		}
	}
	e.do(b, "POST", "/api/v1/scheduling/occurrences/invoice", map[string]any{"occurrence_ids": []string{a.ID, x.ID}}, 201, &out)
	if len(out.Data.InvoiceIDs) != 1 {
		t.Fatalf("one draft per client: %v", out.Data.InvoiceIDs)
	}
	if got := e.occurrence(b, a.ID); got.Invoice == nil || got.Invoice.ID != out.Data.InvoiceIDs[0] || got.Invoice.Status != "draft" {
		t.Fatalf("occurrence names its invoice: %+v", got.Invoice)
	}
	e.fails(b, "POST", "/api/v1/scheduling/occurrences/invoice", map[string]any{"occurrence_ids": []string{a.ID}}, 409, "already_invoiced")
	// A deleted draft releases its sessions.
	e.do(b, "DELETE", "/api/v1/invoices/"+out.Data.InvoiceIDs[0], nil, http.StatusNoContent, nil)
	e.do(b, "POST", "/api/v1/scheduling/occurrences/invoice", map[string]any{"occurrence_ids": []string{a.ID}}, 201, nil)
}

func TestRequestsFromClients(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.client(b, "anna@mueller.example")
	eng := e.engagement(b, c)
	ws := e.ws(b)
	ctx := context.Background()
	mk := func(local string) Occurrence {
		return e.create(b, map[string]any{"client_id": c, "engagement_id": eng, "starts_local": local, "duration_minutes": 60}).Data.Occurrences[0]
	}

	t.Run("on-time cancel is approved at once", func(t *testing.T) {
		o := mk("2026-11-25T09:00")
		req, cancelled, err := e.svc.RequestCancel(ctx, ws, c, o.ID, "anna@mueller.example", nil)
		if err != nil || !cancelled || req.Status != "approved" || req.Late {
			t.Fatalf("%+v %v %v", req, cancelled, err)
		}
		if got := e.occurrence(b, o.ID); got.Status != "cancelled_on_time" || got.Counts {
			t.Fatalf("%+v", got)
		}
		if _, _, err := e.svc.RequestCancel(ctx, ws, c, o.ID, "", nil); err != errNotOpen {
			t.Fatalf("closed: %v", err)
		}
	})

	t.Run("late cancel waits and counts once approved", func(t *testing.T) {
		o := mk("2026-11-16T15:00")
		req, cancelled, err := e.svc.RequestCancel(ctx, ws, c, o.ID, "", nil)
		if err != nil || cancelled || req.Status != "pending" || !req.Late {
			t.Fatalf("%+v %v %v", req, cancelled, err)
		}
		if _, _, err := e.svc.RequestCancel(ctx, ws, c, o.ID, "", nil); err == nil {
			t.Fatal("a second open request is refused")
		}
		var list struct{ Data []RequestItem }
		e.do(b, "GET", "/api/v1/scheduling/requests", nil, 200, &list)
		if len(list.Data) != 1 || list.Data[0].Occurrence.ID != o.ID || list.Data[0].Occurrence.Client.Name != "Müller AG" {
			t.Fatalf("requests: %+v", list.Data)
		}
		var got struct{ Data Occurrence }
		e.do(b, "POST", "/api/v1/scheduling/requests/"+req.ID+"/approve", map[string]any{}, 200, &got)
		if got.Data.Status != "cancelled_late" || !got.Data.Counts || len(got.Data.EntryIDs) != 1 {
			t.Fatalf("approved late: %+v", got.Data)
		}
		e.fails(b, "POST", "/api/v1/scheduling/requests/"+req.ID+"/decline", map[string]any{}, 409, "request_closed")
	})

	t.Run("reschedule approved moves the same row", func(t *testing.T) {
		o := mk("2026-11-30T09:00")
		at := mustTime("2026-12-02T13:00:00Z")
		req, err := e.svc.RequestReschedule(ctx, ws, c, o.ID, "", []time.Time{at}, nil)
		if err != nil || req.Late {
			t.Fatalf("%+v %v", req, err)
		}
		var got struct{ Data Occurrence }
		e.do(b, "POST", "/api/v1/scheduling/requests/"+req.ID+"/approve", map[string]any{}, 200, &got)
		if got.Data.ID != o.ID || !got.Data.StartsAt.Equal(at) || got.Data.Status != "rescheduled" || got.Data.Sequence != o.Sequence+1 {
			t.Fatalf("moved: %+v", got.Data)
		}
	})

	t.Run("proposal accepted by the client", func(t *testing.T) {
		o := mk("2026-12-07T09:00")
		blocker := mk("2026-12-09T09:00")
		req, err := e.svc.RequestReschedule(ctx, ws, c, o.ID, "", []time.Time{mustTime("2026-12-08T08:00:00Z")}, nil)
		if err != nil {
			t.Fatal(err)
		}
		e.fails(b, "POST", "/api/v1/scheduling/requests/"+req.ID+"/approve", map[string]any{"starts_at": blocker.StartsAt}, 409, "slot_taken")
		e.do(b, "POST", "/api/v1/scheduling/requests/"+req.ID+"/propose", map[string]any{"starts_at": "2026-12-10T08:00:00Z"}, 200, nil)
		if _, err := e.svc.Answer(ctx, ws, "cli_other", req.ID, "accept"); err == nil {
			t.Fatal("another client's request is not found")
		}
		ans, err := e.svc.Answer(ctx, ws, c, req.ID, "accept")
		if err != nil || ans.Status != "accepted" {
			t.Fatalf("%+v %v", ans, err)
		}
		if got := e.occurrence(b, o.ID); !got.StartsAt.Equal(mustTime("2026-12-10T08:00:00Z")) || got.Request != nil {
			t.Fatalf("accepted: %+v", got)
		}
	})

	t.Run("withdraw and decline", func(t *testing.T) {
		o := mk("2026-12-14T09:00")
		req, err := e.svc.RequestReschedule(ctx, ws, c, o.ID, "", []time.Time{mustTime("2026-12-15T08:00:00Z")}, nil)
		if err != nil {
			t.Fatal(err)
		}
		if ans, err := e.svc.Answer(ctx, ws, c, req.ID, "withdraw"); err != nil || ans.Status != "withdrawn" {
			t.Fatalf("%+v %v", ans, err)
		}
		req, _ = e.svc.RequestReschedule(ctx, ws, c, o.ID, "", []time.Time{mustTime("2026-12-15T08:00:00Z")}, nil)
		var got struct{ Data Request }
		e.do(b, "POST", "/api/v1/scheduling/requests/"+req.ID+"/decline", map[string]any{"reason": "Full that week"}, 200, &got)
		if got.Data.Status != "declined" || *got.Data.Reason != "Full that week" {
			t.Fatalf("%+v", got.Data)
		}
		if _, err := e.svc.RequestReschedule(ctx, ws, c, o.ID, "", nil, nil); err == nil {
			t.Fatal("a reschedule needs a time")
		}
	})
}

func (e *env) ws(b *browser) storeWorkspace {
	e.t.Helper()
	w, err := e.st.AdmissionWorkspace(context.Background(), b.workspace)
	if err != nil {
		e.t.Fatal(err)
	}
	return w
}

type storeWorkspace = store.Workspace
