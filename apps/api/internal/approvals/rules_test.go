package approvals

import (
	"slices"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestMatch(t *testing.T) {
	a, b := "acc", "mgmt"
	rule := func(g *string, n int) store.ApprovalRule { return store.ApprovalRule{GroupID: g, Min: n} }
	tests := []struct {
		name      string
		rules     []store.ApprovalRule
		approvers [][]string
		filled    []int
		ok        bool
	}{
		{"no rules never hold", nil, [][]string{{a}}, []int{}, false},
		{"anyone two of two", []store.ApprovalRule{rule(nil, 2)}, [][]string{{}, {a}}, []int{2}, true},
		{"anyone two of one", []store.ApprovalRule{rule(nil, 2)}, [][]string{{a}}, []int{1}, false},
		{"group needs its members", []store.ApprovalRule{rule(&a, 1)}, [][]string{{b}}, []int{0}, false},
		{"A and B each", []store.ApprovalRule{rule(&a, 1), rule(&b, 1)}, [][]string{{a}, {b}}, []int{1, 1}, true},
		{"one person in both groups counts once", []store.ApprovalRule{rule(&a, 1), rule(&b, 1)}, [][]string{{a, b}}, []int{1, 0}, false},
		// the first approver could take A's slot greedily; matching moves them to B so the second fills A
		{"reassigns to fill every rule", []store.ApprovalRule{rule(&a, 1), rule(&b, 1)}, [][]string{{a, b}, {a}}, []int{1, 1}, true},
		{"group minimum of two", []store.ApprovalRule{rule(&a, 2), rule(&b, 1)}, [][]string{{a}, {a}, {b}}, []int{2, 1}, true},
		{"group minimum short", []store.ApprovalRule{rule(&a, 2), rule(&b, 1)}, [][]string{{a}, {b}, {b}}, []int{1, 1}, false},
		{"anyone after a group", []store.ApprovalRule{rule(&a, 1), rule(nil, 1)}, [][]string{{a}, {}}, []int{1, 1}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filled := match(tt.rules, tt.approvers)
			if !slices.Equal(filled, tt.filled) {
				t.Fatalf("filled %v, want %v", filled, tt.filled)
			}
			if ok := satisfied(tt.rules, tt.approvers); ok != tt.ok {
				t.Fatalf("satisfied %v, want %v", ok, tt.ok)
			}
		})
	}
}
