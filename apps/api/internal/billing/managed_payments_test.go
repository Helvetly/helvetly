package billing

import (
	"net/url"
	"testing"
)

func TestManagedPaymentsDropsTheTaxParametersStripeRefuses(t *testing.T) {
	form := url.Values{"automatic_tax[enabled]": {"true"}, "tax_id_collection[enabled]": {"true"},
		"customer_update[name]": {"auto"}, "customer_update[address]": {"auto"},
		"billing_address_collection": {"required"}, "mode": {"subscription"}}
	managedPayments(form)
	for _, k := range []string{"automatic_tax[enabled]", "tax_id_collection[enabled]", "customer_update[name]", "customer_update[address]"} {
		if form.Has(k) {
			t.Errorf("%s still sent under Managed Payments", k)
		}
	}
	if form.Get("managed_payments[enabled]") != "true" || form.Get("mode") != "subscription" || form.Get("billing_address_collection") != "required" {
		t.Fatalf("form: %v", form)
	}
}
