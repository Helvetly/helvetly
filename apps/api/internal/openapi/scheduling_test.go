package openapi_test

import (
	"net/http/httptest"
	"reflect"
	"slices"
	"testing"

	"helvetly.com/api/internal/openapi"
	"helvetly.com/api/internal/scheduling"
	"helvetly.com/api/internal/store"
)

// TestSchemasMatchGoTypesScheduling: the Scheduling schemas have exactly the fields of the types the service writes.
func TestSchemasMatchGoTypesScheduling(t *testing.T) {
	for _, c := range []struct {
		schema string
		typ    reflect.Type
	}{
		{"SchedulingEvent", reflect.TypeFor[scheduling.Event]()},
		{"SchedulingOccurrence", reflect.TypeFor[scheduling.Occurrence]()},
		{"SchedulingConflict", reflect.TypeFor[scheduling.Conflict]()},
		{"SchedulingRequest", reflect.TypeFor[scheduling.Request]()},
		{"SchedulingRequestItem", reflect.TypeFor[scheduling.RequestItem]()},
		{"SchedulingOccurrenceSummary", reflect.TypeFor[scheduling.OccurrenceSummary]()},
		{"SchedulingBusyBlock", reflect.TypeFor[scheduling.BusyBlock]()},
		{"SchedulingEventType", reflect.TypeFor[store.SchedEventType]()},
		{"SchedulingRef", reflect.TypeFor[scheduling.Ref]()},
		{"SchedulingEngagementRef", reflect.TypeFor[scheduling.EngagementRef]()},
		{"SchedulingMeeting", reflect.TypeFor[scheduling.Meeting]()},
		{"SchedulingWaived", reflect.TypeFor[scheduling.Waived]()},
		{"SchedulingInvoiceRef", reflect.TypeFor[scheduling.InvoiceRef]()},
		{"SchedulingRecurrence", reflect.TypeFor[scheduling.RecurrenceJSON]()},
		{"SchedulingSetPos", reflect.TypeFor[scheduling.SetPosJSON]()},
	} {
		t.Run(c.schema, func(t *testing.T) {
			for _, d := range openapi.Drift(c.schema, c.typ) {
				t.Error(d)
			}
		})
	}
}

// TestSchedulingPublicOperations: the contract's public operations are MCP tools under the scheduling resource; the
// session-only routes (decisions on requests, invoicing, settings, holidays, event type writes, hours, booking links)
// refuse an API token.
func TestSchedulingPublicOperations(t *testing.T) {
	var ids []string
	for _, op := range openapi.Operations {
		if op.Resource == "scheduling" {
			ids = append(ids, op.ID)
		}
	}
	slices.Sort(ids)
	want := []string{"cancel_session", "create_session", "get_session", "list_busy_times", "list_session_requests", "list_session_types",
		"list_sessions", "set_session_attendance", "update_session"}
	if !slices.Equal(ids, want) {
		t.Fatalf("scheduling operations %v, want %v", ids, want)
	}
	allow := openapi.BearerRoutes("POST /api/mcp")
	for _, c := range []struct {
		method, path   string
		allowed, write bool
	}{
		{"GET", "/api/v1/scheduling/occurrences", true, false},
		{"GET", "/api/v1/scheduling/occurrences/soc_1", true, false},
		{"PATCH", "/api/v1/scheduling/occurrences/soc_1", true, true},
		{"POST", "/api/v1/scheduling/occurrences/soc_1/cancel", true, true},
		{"POST", "/api/v1/scheduling/occurrences/soc_1/attendance", true, true},
		{"POST", "/api/v1/scheduling/events", true, true},
		{"GET", "/api/v1/scheduling/busy", true, false},
		{"GET", "/api/v1/scheduling/requests", true, false},
		{"GET", "/api/v1/scheduling/event-types", true, false},
		{"GET", "/api/v1/scheduling/events/sev_1", false, false},
		{"GET", "/api/v1/scheduling/occurrences/soc_1/ics", false, false},
		{"POST", "/api/v1/scheduling/occurrences/invoice", false, false},
		{"POST", "/api/v1/scheduling/requests/srq_1/approve", false, false},
		{"POST", "/api/v1/scheduling/requests/srq_1/decline", false, false},
		{"POST", "/api/v1/scheduling/requests/srq_1/propose", false, false},
		{"PUT", "/api/v1/scheduling/settings", false, false},
		{"GET", "/api/v1/scheduling/settings", false, false},
		{"PUT", "/api/v1/scheduling/holidays", false, false},
		{"POST", "/api/v1/scheduling/event-types", false, false},
		{"PUT", "/api/v1/scheduling/hosts/usr_1", false, false},
		{"POST", "/api/v1/scheduling/booking-links", false, false},
		{"GET", "/api/v1/scheduling/calendars", false, false},
		{"GET", "/api/v1/scheduling/feed", false, false},
	} {
		allowed, resource, write := allow(httptest.NewRequest(c.method, c.path, nil))
		if allowed != c.allowed || write != c.write || allowed && resource != "scheduling" {
			t.Errorf("%s %s: %v %q %v, want %v %v", c.method, c.path, allowed, resource, write, c.allowed, c.write)
		}
	}
}
