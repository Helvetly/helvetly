package approvals

import (
	"slices"

	"helvetly.com/api/internal/store"
)

// fits: an approver with these groups may fill a slot of the rule.
func fits(r store.ApprovalRule, groups []string) bool {
	return r.GroupID == nil || slices.Contains(groups, *r.GroupID)
}

// match assigns approvers (their groups each) to the rules' slots so that one person fills at most one slot
// (bipartite matching), and returns how many slots of each rule are filled. Rules hold when every rule is full.
func match(rules []store.ApprovalRule, approvers [][]string) []int {
	var slots []int // the rule of each slot
	for i, r := range rules {
		for range r.Min {
			slots = append(slots, i)
		}
	}
	owner := make([]int, len(slots)) // the approver in each slot, -1 when empty
	for i := range owner {
		owner[i] = -1
	}
	var try func(a int, seen []bool) bool
	try = func(a int, seen []bool) bool {
		for s, r := range slots {
			if seen[s] || !fits(rules[r], approvers[a]) {
				continue
			}
			seen[s] = true
			if owner[s] < 0 || try(owner[s], seen) {
				owner[s] = a
				return true
			}
		}
		return false
	}
	for a := range approvers {
		try(a, make([]bool, len(slots)))
	}
	filled := make([]int, len(rules))
	for s, a := range owner {
		if a >= 0 {
			filled[slots[s]]++
		}
	}
	return filled
}

// satisfied: every rule has its minimum, each person counted once.
func satisfied(rules []store.ApprovalRule, approvers [][]string) bool {
	filled := match(rules, approvers)
	for i, r := range rules {
		if filled[i] < r.Min {
			return false
		}
	}
	return len(rules) > 0
}
