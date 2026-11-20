package invoicepdf

import (
	"bytes"
	"slices"
	"strings"
	"testing"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/swissqr"
)

func withInstalments(d Document, refs ...*string) Document {
	d.Invoice.Instalments = &store.InstalmentSchedule{Interval: "monthly", Items: []store.InstalmentItem{
		{Seq: 1, DueDate: "2026-12-01", Amount: 36035}, {Seq: 2, DueDate: "2027-01-01", Amount: 36035},
		{Seq: 3, DueDate: "2027-02-01", Amount: 36030}}}
	for i, ref := range refs {
		d.Invoice.Instalments.Items[i].Reference = ref
	}
	return d
}

func TestQRPerInstalmentAmountsAndReferences(t *testing.T) {
	qrr := []*string{ptr(swissqr.QRR("202600000101")), ptr(swissqr.QRR("202600000102")), ptr(swissqr.QRR("202600000103"))}
	scor := ptr(swissqr.SCOR("202600000101"))
	tests := []struct {
		name               string
		doc                Document
		wantType, wantRefs []string
	}{
		{"issued QRR", withInstalments(sample("de", 3), qrr...), []string{"QRR", "QRR", "QRR"},
			[]string{*qrr[0], *qrr[1], *qrr[2]}},
		{"issued SCOR on a NON bill", func() Document {
			d := withInstalments(sample("en", 3), scor)
			d.Bill.ReferenceType, d.Bill.Reference = "NON", ""
			return d
		}(), []string{"SCOR", "NON", "NON"}, []string{*scor, "", ""}},
		{"draft keeps the bill's reference", withInstalments(sample("de", 3)), []string{"QRR", "QRR", "QRR"},
			[]string{"000000000000000000202600000", "000000000000000000202600000", "000000000000000000202600000"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bills := instalmentBills(tt.doc)
			if len(bills) != 3 {
				t.Fatalf("%d bills, want 3", len(bills))
			}
			for i, b := range bills {
				lines := strings.Split(b.Payload(), "\n")
				if amount := lines[18]; amount != []string{"360.35", "360.35", "360.30"}[i] {
					t.Errorf("bill %d amount %s", i+1, amount)
				}
				if lines[27] != tt.wantType[i] || lines[28] != tt.wantRefs[i] {
					t.Errorf("bill %d reference %s %s, want %s %s", i+1, lines[27], lines[28], tt.wantType[i], tt.wantRefs[i])
				}
			}
			out, err := Render(tt.doc)
			if err != nil {
				t.Fatal(err)
			}
			if got := len(pageObject.FindAll(out, -1)); got != 4 {
				t.Fatalf("%d pages, want 1 invoice page + 3 QR pages", got)
			}
		})
	}
	if text := pageText(t, withInstalments(sample("de", 3), qrr...)); !shows(text, "360.30") || !shows(text, "Rate 3 von 3 · fällig 01.02.2027") {
		t.Error("the third slip does not show its amount and instalment")
	}
}

func TestScheduleTableLabelsAllLanguages(t *testing.T) {
	for lang, want := range map[string][]string{
		"de": {"Ratenplan", "Fällig", "01.01.2027", "CHF 360.35", "Rate 2 von 3 · fällig 01.01.2027", "Rate 2/6"},
		"fr": {"Plan de paiement", "Échéance", "01.01.2027", "CHF 360.35", "Versement 2 sur 3 · échéance 01.01.2027", "Versement 2/6"},
		"it": {"Piano rateale", "Scadenza", "01.01.2027", "CHF 360.35", "Rata 2 di 3 · scadenza 01.01.2027", "Rata 2/6"},
		"en": {"Instalment schedule", "Due", "01.01.2027", "CHF 360.35", "Instalment 2 of 3 · due 01.01.2027", "Instalment 2/6"},
	} {
		d := withInstalments(sample(lang, 3))
		d.Invoice.Kind, d.Invoice.Plan = "partial", &store.PlanRef{ID: "plan_1", Seq: 2, Count: 6}
		text := pageText(t, d)
		for _, s := range want {
			if !shows(text, s) {
				t.Errorf("%s: %q not printed", lang, s)
			}
		}
	}
	d := sample("en", 1)
	d.Invoice.Plan = &store.PlanRef{ID: "plan_1", Seq: 0, Count: 6}
	if shows(pageText(t, d), "Instalment 0/6") {
		t.Error("a plan's source draft is labelled as an instalment")
	}
}

func TestNoInstalmentsUnchanged(t *testing.T) {
	d := sample("de", 3)
	if bills := instalmentBills(d); bills != nil {
		t.Fatalf("instalment bills without a schedule: %d", len(bills))
	}
	plain, err := Render(d)
	if err != nil {
		t.Fatal(err)
	}
	plainText := pageText(t, d)
	before := sortedStreams(t, d)
	d.Invoice.Instalments = &store.InstalmentSchedule{Interval: "monthly"} // no items: nothing changes
	if after := sortedStreams(t, d); !slices.EqualFunc(before, after, bytes.Equal) {
		t.Error("an empty schedule changes the PDF")
	}
	if shows(plainText, "Ratenplan") || len(pageObject.FindAll(plain, -1)) != 2 {
		t.Error("schedule printed or QR pages added without instalments")
	}
}

// sortedStreams ignores stream order: fpdf writes the embedded fonts in map order.
func sortedStreams(t *testing.T, d Document) [][]byte {
	t.Helper()
	all := streams(t, d)
	slices.SortFunc(all, bytes.Compare)
	return all
}
