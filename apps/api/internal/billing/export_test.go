package billing

// GatedRoutes is the route map for the tests outside the package (billing_test), which wire billingtest.
func GatedRoutes() map[string]Feature { return gated }
