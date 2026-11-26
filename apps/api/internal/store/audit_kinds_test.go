package store

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// The platform gives every kind its own sentence from its own list: it must name the same kinds.
func TestPlatformKnowsEveryAuditKind(t *testing.T) {
	src, err := os.ReadFile("../../../platform/src/lib/audit-log.ts")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	start := strings.Index(body, "export const AUDIT_KINDS = [")
	end := strings.Index(body[max(start, 0):], "] as const")
	if start < 0 || end < 0 {
		t.Fatal("the platform's AUDIT_KINDS list is gone")
	}
	var platform []string
	for _, m := range regexp.MustCompile(`'([a-z_]+\.[a-z_]+)'`).FindAllStringSubmatch(body[start:start+end], -1) {
		platform = append(platform, m[1])
	}
	if !slices.Equal(platform, AuditKinds) {
		t.Fatalf("platform kinds %v,\nAPI kinds %v", platform, AuditKinds)
	}
}

func TestCheckAuditKind(t *testing.T) {
	if err := checkAuditKind("payment.added"); err != nil {
		t.Fatal(err)
	}
	if err := checkAuditKind("something.new"); err == nil {
		t.Fatal("an unlisted kind passed")
	}
}
