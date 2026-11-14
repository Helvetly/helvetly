// Package members is a workspace's people and their roles (docs/members-contract.md).
package members

// ValidRole reports whether role is one of the three workspace roles.
func ValidRole(role string) bool {
	switch role {
	case "owner", "admin", "member":
		return true
	}
	return false
}

// CanManage reports whether actor may invite, change roles and remove people.
func CanManage(actor string) bool {
	return actor == "owner" || actor == "admin"
}

// CanAssign reports whether actor may move a person from one role to another.
func CanAssign(actor, from, to string) bool {
	if !ValidRole(to) {
		return false
	}
	switch actor {
	case "owner":
		return true
	case "admin":
		return from != "owner" && to != "owner"
	}
	return false
}
