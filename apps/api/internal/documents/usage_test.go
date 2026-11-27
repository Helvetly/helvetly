package documents

import (
	"reflect"
	"testing"

	"helvetly.com/api/internal/billing/billingtest"
	"helvetly.com/api/internal/store"
)

func TestUsageOf(t *testing.T) {
	for _, tc := range []struct {
		name string
		rows []store.UsageRow
		want usage
	}{
		{"empty", nil, usage{ByKind: []kindTally{}}},
		{"kinds folded in UI order, trash apart", []store.UsageRow{
			{ContentType: "image/png", Files: 2, Size: 20},
			{ContentType: "application/pdf", Files: 1, Size: 5},
			{ContentType: "image/jpeg", Files: 1, Size: 10},
			{ContentType: "application/x-legacy", Files: 1, Size: 1},
			{ContentType: "application/pdf", Trashed: true, Files: 3, Size: 30},
		}, usage{
			tally: tally{5, 36},
			ByKind: []kindTally{
				{"pdf", tally{1, 5}},
				{"image", tally{3, 30}},
				{"other", tally{1, 1}},
			},
			Trash: tally{3, 30},
		}},
	} {
		if got := usageOf(tc.rows); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: usageOf = %+v, want %+v", tc.name, got, tc.want)
		}
	}
}

func TestUsageRoute(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	other := e.workspace()
	f := e.folder(b, "Projects", nil)
	e.uploaded(b, "plan.pdf", pdf, "folder_id", f.ID)
	e.uploaded(b, "sketch.png", png)
	gone := e.uploaded(b, "old.pdf", "%PDF-1.7\nolder")
	e.uploaded(other, "theirs.pdf", pdf)
	e.bulk(b, map[string]any{"action": "trash", "document_ids": []string{gone.ID}})

	billingSvc := billingtest.Wire(t, e.st)
	e.svc.SetStorageCapacity(billingSvc.StorageCapacity)
	capacity, err := billingSvc.StorageCapacity(t.Context(), b.workspace)
	if err != nil || capacity <= 0 {
		t.Fatalf("storage cap = %d, %v", capacity, err)
	}
	for _, tc := range []struct {
		who  *browser
		want usage
	}{
		{b, usage{
			StoredBytes: int64(len(pdf) + len(png) + len("%PDF-1.7\nolder")),
			tally:       tally{2, int64(len(pdf) + len(png))},
			ByKind:      []kindTally{{"pdf", tally{1, int64(len(pdf))}}, {"image", tally{1, int64(len(png))}}},
			Trash:       tally{1, int64(len(pdf))},
		}},
		{other, usage{StoredBytes: int64(len(pdf)), tally: tally{1, int64(len(pdf))}, ByKind: []kindTally{{"pdf", tally{1, int64(len(pdf))}}}}},
	} {
		tc.want.CapacityBytes = &capacity
		var out one[usage]
		e.do(tc.who, "GET", "/api/v1/documents/usage", nil, 200, &out)
		if !reflect.DeepEqual(out.Data, tc.want) {
			t.Errorf("usage = %+v, want %+v", out.Data, tc.want)
		}
	}
	e.fails(nil, "GET", "/api/v1/documents/usage", nil, 401, "unauthenticated")
}
