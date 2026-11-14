package members

import "testing"

func TestCanAssign(t *testing.T) {
	tests := []struct {
		name        string
		actor, from string
		to          string
		want        bool
	}{
		{"owner demotes owner", "owner", "owner", "member", true},
		{"owner promotes to owner", "owner", "member", "owner", true},
		{"owner assigns admin", "owner", "member", "admin", true},
		{"owner assigns bogus role", "owner", "member", "bogus", false},
		{"admin promotes member to admin", "admin", "member", "admin", true},
		{"admin demotes admin to member", "admin", "admin", "member", true},
		{"admin touches owner", "admin", "owner", "admin", false},
		{"admin assigns owner", "admin", "member", "owner", false},
		{"admin assigns bogus role", "admin", "member", "bogus", false},
		{"member cannot assign", "member", "member", "admin", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := CanAssign(tt.actor, tt.from, tt.to); got != tt.want {
				t.Errorf("CanAssign(%q, %q, %q) = %v, want %v", tt.actor, tt.from, tt.to, got, tt.want)
			}
		})
	}
}

func TestCanManage(t *testing.T) {
	tests := []struct {
		actor string
		want  bool
	}{
		{"owner", true},
		{"admin", true},
		{"member", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run("actor="+tt.actor, func(t *testing.T) {
			if got := CanManage(tt.actor); got != tt.want {
				t.Errorf("CanManage(%q) = %v, want %v", tt.actor, got, tt.want)
			}
		})
	}
}

func TestValidRole(t *testing.T) {
	tests := []struct {
		role string
		want bool
	}{
		{"owner", true},
		{"admin", true},
		{"member", true},
		{"Owner", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run("role="+tt.role, func(t *testing.T) {
			if got := ValidRole(tt.role); got != tt.want {
				t.Errorf("ValidRole(%q) = %v, want %v", tt.role, got, tt.want)
			}
		})
	}
}
