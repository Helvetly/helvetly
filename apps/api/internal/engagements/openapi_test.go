package engagements

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/openapi"
)

// The public API documents the summary (get_engagements_summary); its response type is unexported.
func TestDocumentedSummaryMatches(t *testing.T) {
	for _, d := range openapi.Drift("EngagementSummary", reflect.TypeFor[summaryBody]()) {
		t.Error(d)
	}
}
