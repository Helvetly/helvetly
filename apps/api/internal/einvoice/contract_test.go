package einvoice

import (
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
)

func TestContractReferenceIsBT12(t *testing.T) {
	withContract := func(inv store.Invoice) store.Invoice { inv.ContractReference = ptr("C23-25-CP2302"); return inv }
	for _, tc := range []struct {
		name, xml string
		order     []string // elements in schema order
	}{
		{"UBL invoice", mustUBL(t, withContract(simple()), "xrechnung"),
			[]string{"<cac:OrderReference>", "<cac:ContractDocumentReference><cbc:ID>C23-25-CP2302</cbc:ID></cac:ContractDocumentReference>", "<cac:AccountingSupplierParty>"}},
		{"UBL credit note", mustUBL(t, withContract(creditNote()), "xrechnung"),
			[]string{"<cac:BillingReference>", "<cac:ContractDocumentReference><cbc:ID>C23-25-CP2302</cbc:ID></cac:ContractDocumentReference>", "<cac:AccountingSupplierParty>"}},
		{"CII", mustCII(t, withContract(simple())),
			[]string{"<ram:BuyerTradeParty>", "<ram:ContractReferencedDocument><ram:IssuerAssignedID>C23-25-CP2302</ram:IssuerAssignedID></ram:ContractReferencedDocument>", "</ram:ApplicableHeaderTradeAgreement>"}},
	} {
		at := -1
		for _, el := range tc.order {
			i := strings.Index(tc.xml, el)
			if i <= at {
				t.Errorf("%s: %s missing or out of order:\n%s", tc.name, el, tc.xml)
			}
			at = i
		}
	}
	for name, xml := range map[string]string{"UBL": mustUBL(t, simple(), "xrechnung"), "CII": mustCII(t, simple())} {
		if strings.Contains(xml, "Contract") {
			t.Errorf("%s without a contract number names one", name)
		}
	}
}
