package imports

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/store"
)

// TestModelQualityOnMultilingualInvoices asks the real model to read synthetic invoices in several languages and
// number formats through the production invoice prompt, and checks every field it should find. It costs money and
// needs the network, so it runs only on request, never in CI:
//
//	HELVETLY_AI_QUALITY=1 OPENAI_API_KEY=... go test ./internal/imports -run TestModelQuality -v
func TestModelQualityOnMultilingualInvoices(t *testing.T) {
	key := os.Getenv("OPENAI_API_KEY")
	if os.Getenv("HELVETLY_AI_QUALITY") != "1" || key == "" {
		t.Skip("set HELVETLY_AI_QUALITY=1 and OPENAI_API_KEY to run the model quality check")
	}
	model := cmp.Or(os.Getenv("OPENAI_MODEL"), aimodel.DefaultModel)
	base := cmp.Or(os.Getenv("OPENAI_BASE_URL"), "https://api.openai.com/v1")
	e := newEnv(t)
	e.s.provider = aimodel.NewOpenAI(key, base, model)

	docs := []struct {
		name, text string
		want       map[string]string // field → expected; line fields are line0.<name>
	}{
		{"de-CH", "Müller Informatik GmbH, Bahnhofstrasse 1, 8001 Zürich\nRechnung Nr. 2026-0412\nRechnungsdatum: 03.11.2026\nZahlbar bis: 03.12.2026\n\nRechnungsempfänger:\nMüller Bau AG, Industriestrasse 9, 3000 Bern\n\nPos. Beschreibung        Menge  Einheit  Preis      Betrag\n1    IT-Beratung         6      Std.     CHF 150.00 CHF 900.00\n\nZwischentotal netto CHF 900.00\nMWST 8.1% CHF 72.90\nTotal CHF 972.90",
			map[string]string{"number": "2026-0412", "issue_date": "2026-11-03", "due_date": "2026-12-03", "currency": "CHF", "total": "972.90", "client_name": "Müller Bau AG", "line0.quantity": "6", "line0.unit_price": "150", "line0.vat_rate": "8.1", "line0.unit": "hour"}},
		{"fr-CH", "Atelier Web Sàrl, Rue du Lac 4, 1003 Lausanne\nFACTURE N° F-889\nDate : 15 octobre 2026\nÉchéance : 30 jours\n\nClient : Boulangerie Dupont SA, Place de la Gare 2, 1700 Fribourg\n\nDéveloppement du site web (forfait)   1   2 400,00 CHF\n\nTotal HT 2 400,00 CHF\nTVA 8,1 % 194,40 CHF\nTotal TTC 2 594,40 CHF",
			map[string]string{"number": "F-889", "issue_date": "2026-10-15", "currency": "CHF", "total": "2594.40", "client_name": "Boulangerie Dupont SA", "line0.quantity": "1", "line0.unit_price": "2400", "line0.vat_rate": "8.1", "line0.unit": "flat"}},
		{"it", "Studio Bianchi, Via Roma 10, 20121 Milano, P.IVA IT01234567890\nFattura n. 77/2026 del 2 settembre 2026\n\nSpett.le Rossi Srl, Corso Italia 5, 10121 Torino\n\nConsulenza strategica   3 giorni   € 800,00 cad.   € 2.400,00\n\nImponibile € 2.400,00\nIVA 22% € 528,00\nTotale fattura € 2.928,00",
			map[string]string{"number": "77/2026", "issue_date": "2026-09-02", "currency": "EUR", "total": "2928.00", "client_name": "Rossi Srl", "line0.quantity": "3", "line0.unit_price": "800", "line0.vat_rate": "22", "line0.unit": "day"}},
		{"pl", "Sprzedawca: Nowak Software Sp. z o.o., ul. Długa 1, 00-001 Warszawa, NIP 525-111-22-33\nFaktura VAT nr FV/11/2026/005\nData wystawienia: 10.11.2026\nTermin płatności: 24.11.2026\n\nNabywca: Kowalski Sp. z o.o., ul. Krótka 2, 30-001 Kraków, NIP 676-000-00-00\n\nLp. Nazwa usługi              Ilość  J.m.   Cena netto  Wartość netto  VAT\n1   Usługa programistyczna     40     godz.  180,00 zł   7 200,00 zł    23%\n\nRazem netto: 7 200,00 zł\nVAT 23%: 1 656,00 zł\nRazem brutto: 8 856,00 zł\nSłownie: osiem tysięcy osiemset pięćdziesiąt sześć złotych",
			map[string]string{"number": "FV/11/2026/005", "issue_date": "2026-11-10", "due_date": "2026-11-24", "currency": "PLN", "total": "8856.00", "client_name": "Kowalski Sp. z o.o.", "client_vat_number": "676-000-00-00", "line0.quantity": "40", "line0.unit_price": "180", "line0.vat_rate": "23", "line0.unit": "hour"}},
		{"en", "Fabrikam Apps Ltd, 1 High Street, London\nINVOICE INV-3021\nDate: 1 Nov 2026\nDue: 1 Dec 2026\n\nBill to: Northwind Ltd, 200 Main St, Toronto, Canada\n\nItem                     Qty  Unit price  Amount\nAnnual licence           10   USD 49.00   USD 490.00\n\nSubtotal USD 490.00\nDiscount 10% -USD 49.00\nVAT: not applicable (export of services)\nTotal due USD 441.00",
			map[string]string{"number": "INV-3021", "issue_date": "2026-11-01", "due_date": "2026-12-01", "currency": "USD", "total": "441.00", "client_name": "Northwind Ltd", "discount_percent": "10", "line0.quantity": "10", "line0.unit_price": "49"}},
		{"de-DE", "Weber Technik GmbH, Hauptstraße 3, 10115 Berlin\nRechnung 4711 vom 05.08.2026\nLeistungszeitraum: 01.08.2026 bis 31.07.2027\n\nAn: Schmidt GmbH, Lindenweg 7, 80331 München\n\nWartungsvertrag Server   12 Monate   je 1.250,00 €   15.000,00 €\n\nNettobetrag 15.000,00 €\nzzgl. 19 % USt. 2.850,00 €\nGesamtbetrag 17.850,00 €\nBereits bezahlt am 10.08.2026: 5.000,00 €",
			map[string]string{"number": "4711", "issue_date": "2026-08-05", "service_date": "2026-08-01", "service_date_end": "2027-07-31", "currency": "EUR", "total": "17850.00", "client_name": "Schmidt GmbH", "paid_amount": "5000.00", "paid_on": "2026-08-10", "line0.quantity": "12", "line0.unit_price": "1250", "line0.vat_rate": "19", "line0.unit": "month"}},
	}
	ws := e.sess.Workspace
	fields, wrong := 0, 0
	for i, d := range docs {
		f := store.ImportFile{ID: fmt.Sprintf("quality_%d", i), BatchID: "quality", Name: d.name + ".txt"}
		_, records, err := e.s.ask(context.Background(), invoicesKind, ws, f, 0, chunk{text: d.text}, nil)
		if err != nil {
			t.Errorf("%s: %v", d.name, err)
			wrong += len(d.want)
			fields += len(d.want)
			continue
		}
		if len(records["invoices"]) != 1 {
			t.Errorf("%s: %d records, want 1", d.name, len(records["invoices"]))
			continue
		}
		got := records["invoices"][0]
		var lines []map[string]json.RawMessage
		_ = json.Unmarshal(got["lines"], &lines)
		for field, want := range d.want {
			fields++
			raw := got[field]
			if name, ok := strings.CutPrefix(field, "line0."); ok {
				raw = nil
				if len(lines) > 0 {
					raw = lines[0][name]
				}
			}
			if !same(raw, want) {
				wrong++
				t.Errorf("%s: %s = %s, want %s", d.name, field, raw, want)
			}
		}
	}
	u, err := e.db.HeidiUsage(context.Background(), ws.ID, e.s.now().In(ws.Location()).Format("2006-01"))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%s: %d of %d fields right in %d documents; %d tokens, %d micro-USD (%d reserved, pending reconciliation)",
		model, fields-wrong, fields, len(docs), u.TokensUsed, u.CostMicros, u.CostReserved)
}

// same compares a model value with the expected text: numbers by value, text exactly.
func same(raw json.RawMessage, want string) bool {
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return false
	}
	a, errA := strconv.ParseFloat(s, 64)
	b, errB := strconv.ParseFloat(want, 64)
	if errA == nil && errB == nil {
		return a == b
	}
	return strings.TrimSpace(s) == want
}
