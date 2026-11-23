package templates

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"
)

func signaturePNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 300, 100))
	for x := range 300 {
		img.Set(x, 50+x%30, color.NRGBA{A: 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// upload sends one file as multipart "file".
func (e *env) upload(b *browser, path string, content []byte) (int, []byte) {
	e.t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", "signature.png")
	if err != nil {
		e.t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		e.t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		e.t.Fatal(err)
	}
	req, err := http.NewRequest("PUT", e.srv.URL+path, &body)
	if err != nil {
		e.t.Fatal(err)
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "helvetly_session", Value: b.token})
	req.Header.Set("X-CSRF-Token", b.csrf)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}

// An example used as it is: copied byte for byte, numbered and filed, never sent to the model.
func TestContractAsIsCopiesTheExample(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	quoteID, _ := e.quote(b)
	example := samplePDF(t, 2)
	exampleID := e.document(b, example, "application/pdf")
	path := "/api/v1/quotes/" + quoteID + "/contracts"
	body := obj{"as_is": true, "example_document_id": exampleID, "title": "Agreement", "language": "de", "delivery": obj{"type": "save"}}
	var out struct{ Data generatedOut }
	e.do(b, "POST", path, body, http.StatusCreated, &out)
	want := "C-" + time.Now().UTC().Format("2006") + "-001"
	if out.Data.ContractNumber == nil || *out.Data.ContractNumber != want || out.Data.Document.Name != want+".pdf" {
		t.Fatalf("contract: %+v", out.Data)
	}
	doc := e.mustDoc(b, out.Data.Document.ID)
	if !bytes.Equal(e.files.objects[doc.ObjectKey], example) || doc.ID == exampleID {
		t.Fatal("not a copy of the example")
	}
	if n := e.count(`SELECT count(*) FROM quote_contracts WHERE quote_id = $1 AND number = $2 AND sections IS NULL`, quoteID, want); n != 1 {
		t.Fatalf("linked to the quote: %d", n)
	}
	// it has no signature block: its fields are placed by the person, never guessed
	body["delivery"] = obj{"type": "signature", "signers": []obj{{"name": "Peter", "email": "peter@mueller.ch"}}, "signed": true}
	if got := e.fail(b, "POST", path, body, http.StatusUnprocessableEntity); got.Details.Fields["delivery.type"] == "" {
		t.Fatalf("signature for an example as it is: %+v", got)
	}
	body["delivery"], body["example_document_id"] = obj{"type": "save"}, "doc_missing"
	if got := e.fail(b, "POST", path, body, http.StatusUnprocessableEntity); got.Details.Fields["example_document_id"] == "" {
		t.Fatalf("missing example: %+v", got)
	}
}

// The member's stored signature is printed on the contractor's side with place and date, audited, and the client
// alone signs: a date and a signature field in its column.
func TestContractSignatureAutoApplied(t *testing.T) {
	e := newEnv(t, true)
	b := e.workspace()
	quoteID, _ := e.quote(b)
	path := "/api/v1/quotes/" + quoteID + "/contracts"
	client := []obj{{"name": "Peter Müller", "email": "peter@mueller.ch"}}
	signed := obj{"type": "signature", "signers": client, "signed": true, "signing_order": "parallel", "expires_in_days": 30}

	if got := e.fail(b, "POST", path, reviewed(signed), http.StatusConflict); got.Code != "signature_missing" {
		t.Fatalf("without a stored signature: %+v", got)
	}
	if status, raw := e.upload(b, "/api/v1/account/contract-signature/image", signaturePNG(t)); status != http.StatusOK {
		t.Fatalf("upload: %d %s", status, raw)
	}
	if status, _ := e.upload(b, "/api/v1/account/contract-signature/image", []byte("not an image")); status != http.StatusUnprocessableEntity {
		t.Fatalf("a non-image: %d", status)
	}
	var view struct{ Data signatureView }
	e.do(b, "PUT", "/api/v1/account/contract-signature", obj{"place": "Winterthur"}, http.StatusOK, &view)
	if !view.Data.HasImage || view.Data.Place != "Winterthur" {
		t.Fatalf("signature: %+v", view.Data)
	}
	// private: only the member reads the image, and it is no document
	if status, raw := e.send(b, "GET", "/api/v1/account/contract-signature/image", nil); status != http.StatusOK || !bytes.HasPrefix(raw, []byte("\x89PNG")) {
		t.Fatalf("own image: %d", status)
	}
	if status, _ := e.send(e.workspace(), "GET", "/api/v1/account/contract-signature/image", nil); status != http.StatusNotFound {
		t.Fatalf("someone else's image: %d", status)
	}
	if n := e.count(`SELECT count(*) FROM documents WHERE workspace_id = $1`, b.workspace); n != 0 {
		t.Fatalf("the signature became a document: %d", n)
	}

	var out struct{ Data generatedOut }
	e.do(b, "POST", path, reviewed(signed), http.StatusCreated, &out)
	pdf := e.files.objects[e.mustDoc(b, out.Data.Document.ID).ObjectKey]
	zurich, err := time.LoadLocation("Europe/Zurich")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Winterthur, " + time.Now().In(zurich).Format("02.01.2006"), "Anna Owner", "Peter Müller"} {
		if !bytes.Contains(pdf, utf16be(want)) {
			t.Errorf("the PDF lacks %q", want)
		}
	}
	if !bytes.Contains(pdf, []byte("/Subtype /Image")) {
		t.Error("no signature image")
	}
	var payload []byte
	if err := e.raw.QueryRow(context.Background(), `SELECT payload FROM financial_events WHERE workspace_id = $1
		AND kind = 'contract.signature_applied' AND subject_id = $2`, b.workspace, out.Data.Document.ID).Scan(&payload); err != nil {
		t.Fatalf("not audited: %v", err)
	}
	var audit map[string]string
	if json.Unmarshal(payload, &audit) != nil || audit["place"] != "Winterthur" || audit["number"] == "" {
		t.Fatalf("audit payload: %s", payload)
	}
	rows, err := e.raw.Query(context.Background(), `SELECT f.kind, f.x FROM signature_fields f
		WHERE f.request_id = $1 ORDER BY f.kind`, *out.Data.SignatureRequestID)
	if err != nil {
		t.Fatal(err)
	}
	var kinds []string
	for rows.Next() {
		var kind string
		var x float64
		if err := rows.Scan(&kind, &x); err != nil {
			t.Fatal(err)
		}
		if x < 0.5 {
			t.Errorf("%s field outside the client's column: x %.2f", kind, x)
		}
		kinds = append(kinds, kind)
	}
	if strings.Join(kinds, ",") != "date,signature" {
		t.Fatalf("client fields: %v", kinds)
	}
	if n := e.count(`SELECT count(*) FROM signature_signers WHERE request_id = $1`, *out.Data.SignatureRequestID); n != 1 {
		t.Fatalf("signers: %d, want the client only", n)
	}
	// signed, two signers is one too many
	signed["signers"] = append(client, obj{"name": "X", "email": "x@example.com"})
	if got := e.fail(b, "POST", path, reviewed(signed), http.StatusUnprocessableEntity); got.Details.Fields["delivery.signers"] == "" {
		t.Fatalf("two signers when signed: %+v", got)
	}
	// removed: the next contract asks again
	e.do(b, "DELETE", "/api/v1/account/contract-signature/image", nil, http.StatusOK, &view)
	if view.Data.HasImage || view.Data.Place != "Winterthur" {
		t.Fatalf("after removal: %+v", view.Data)
	}
}

func TestContractLawAndStatutes(t *testing.T) {
	e := newEnv(t, false)
	b := e.workspace()
	quoteID, _ := e.quote(b)
	var law struct {
		Data struct {
			Default struct{ Code, Family string }
			Options []struct{ Code string }
		}
	}
	e.do(b, "GET", "/api/v1/quotes/"+quoteID+"/contract-law", nil, http.StatusOK, &law)
	if law.Data.Default.Code != "CH" || len(law.Data.Options) < 50 || law.Data.Options[0].Code != "CH" {
		t.Fatalf("law: %+v", law.Data.Default)
	}
	body := reviewed(nil)
	delete(body, "delivery")
	body["clauses"] = []obj{{"heading": "Verzug", "body": "Verzugszins nach Art. 104 OR. Haftung nach § 280 BGB."}}
	var out struct{ Data struct{ Warnings []warning } }
	e.do(b, "POST", "/api/v1/quotes/"+quoteID+"/contract-preview", body, http.StatusOK, &out)
	if len(out.Data.Warnings) != 1 || out.Data.Warnings[0].Kind != "statute" || out.Data.Warnings[0].Text != "§ 280 BGB" {
		t.Fatalf("warnings: %+v", out.Data.Warnings)
	}
	body["governing_law"] = "US-CA"
	e.do(b, "POST", "/api/v1/quotes/"+quoteID+"/contract-preview", body, http.StatusOK, &out)
	if len(out.Data.Warnings) != 2 {
		t.Fatalf("under Californian law both are foreign: %+v", out.Data.Warnings)
	}
	body["governing_law"] = "GB"
	if got := e.fail(b, "POST", "/api/v1/quotes/"+quoteID+"/contract-preview", body, http.StatusUnprocessableEntity); got.Details.Fields["governing_law"] == "" {
		t.Fatalf("unknown law: %+v", got)
	}
}

// Written after an example: the model is told the law's outline and to keep the example; what it answers is kept as
// written, but for contact data neither party has.
func TestContractExampleKeepsItsText(t *testing.T) {
	e := newEnv(t, false)
	b := e.workspace()
	e.consent(b, true)
	original := "Der Auftragnehmer erbringt die Leistungen gemäss Anhang A nach bestem Wissen und Gewissen."
	model := e.withWriter(nil, answer("Werkvertrag", "Zwischen den Parteien.",
		[2]string{"Leistungen", original},
		[2]string{"Kontakt", "Fragen an hans.muster@example.ch."}))
	quoteID, _ := e.quote(b)
	got := e.write(b, quoteID, obj{"mode": "example", "example_document_id": e.document(b, samplePDF(t, 1), "application/pdf")})
	if got.Title != "Werkvertrag" || got.Clauses[0].Body != original || got.Clauses[1].Body != "Fragen an […]." {
		t.Fatalf("draft: %+v", got)
	}
	r := model.last()
	for _, want := range []string{"<law>", "governing law: Switzerland", "Art. 104 OR", "required outline"} {
		if !strings.Contains(r.Message, want) {
			t.Errorf("message lacks %q", want)
		}
	}
}
