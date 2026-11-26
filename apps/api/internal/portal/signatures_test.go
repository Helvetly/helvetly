package portal

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// file adds a document of ws in folder ("" for the top level).
func (e *env) file(id, ws, folder string, trashed, hr bool) {
	e.exec(`INSERT INTO documents (id, workspace_id, folder_id, name, size, content_type, object_key, created_at, updated_at, deleted_at, hr_private)
		VALUES ($1,$2,nullif($3,''),$1 || '.pdf',12,'application/pdf','obj/' || $1,now(),now(),CASE WHEN $4 THEN now() END,$5)`,
		id, ws, folder, trashed, hr)
}

// signature adds a request of ws for document doc sent from folder, signed into signed ("" for none), with one signer
// per address, the first of them still to sign while pending.
func (e *env) signature(id, ws, status, folder, doc, signed string, expired bool, signers ...string) {
	e.exec(`INSERT INTO signature_requests (id, workspace_id, document_id, folder_id, title, signing_order, status, original_key,
		original_sha256, page_count, signed_document_id, expires_at, created_at, updated_at, completed_at)
		VALUES ($1,$2,nullif($4,''),nullif($5,''),'Title ' || $1,'parallel',$3,'orig/' || $1,'x',1,nullif($6,''),
			CASE WHEN $7 THEN now() - interval '1 day' ELSE now() + interval '30 days' END,now(),now(),
			CASE WHEN $3 = 'completed' THEN now() END)`, id, ws, status, doc, folder, signed, expired)
	for i, email := range signers {
		e.exec(`INSERT INTO signature_signers (id, request_id, position, name, email, signed_at)
			VALUES ($1 || '_' || $2::text, $1, $2::int, 'Signer', $3, CASE WHEN $4 = 'completed' THEN now() END)`, id, strconv.Itoa(i), email, status)
	}
}

// Each client sees the signature requests of its own documents (and those of no client it signed), never another
// client's, another workspace's, a revoked one or an HR file's; only a completed one's signed PDF downloads.
func TestPortalSignaturesScoped(t *testing.T) {
	e := scopedEnv(t)
	e.exec(`INSERT INTO document_folders (id, workspace_id, parent_id, name, created_at, updated_at, system_kind, system_ref) VALUES
		('fld_clients','wsp_a',NULL,'Clients',now(),now(),'clients',NULL),
		('fld_acme','wsp_a','fld_clients','Acme AG',now(),now(),'client','cli_1'),
		('fld_acme_docs','wsp_a','fld_acme','Documents',now(),now(),'documents',NULL),
		('fld_gamma','wsp_a','fld_clients','Gamma AG',now(),now(),'client','cli_3')`)
	for _, id := range []string{"doc_a", "doc_a_signed", "doc_contract", "doc_linked", "doc_loose", "doc_loose_signed",
		"doc_g", "doc_revoked", "doc_expired", "doc_t", "doc_t_signed"} {
		e.file(id, "wsp_a", "", id == "doc_t_signed", false)
	}
	e.file("doc_hr", "wsp_a", "", false, true)
	e.file("doc_b", "wsp_b", "", false, false)
	e.quote("quo_1", "cli_1", "sent", "Q-1", nil)
	e.exec(`INSERT INTO quote_contracts (workspace_id, quote_id, document_id, number, created_at) VALUES ('wsp_a','quo_1','doc_contract','C-1',now())`)
	e.exec(`INSERT INTO document_links (document_id, workspace_id, target_type, target_id, created_at) VALUES ('doc_linked','wsp_a','client','cli_1',now())`)

	e.signature("sig_folder", "wsp_a", "completed", "fld_acme_docs", "doc_a", "doc_a_signed", false, "someone@acme.ch")
	e.signature("sig_contract", "wsp_a", "pending", "", "doc_contract", "", false, "cleo@acme.ch")
	e.signature("sig_linked", "wsp_a", "pending", "", "doc_linked", "", false, "ana@acme.ch")
	e.signature("sig_loose", "wsp_a", "completed", "", "doc_loose", "doc_loose_signed", false, "Ana@Acme.ch")
	e.signature("sig_gamma", "wsp_a", "completed", "fld_gamma", "doc_g", "", false, "ana@acme.ch") // Gamma's, though Ana signed
	e.signature("sig_hr", "wsp_a", "completed", "", "doc_hr", "", false, "ana@acme.ch")
	e.signature("sig_revoked", "wsp_a", "revoked", "", "doc_revoked", "", false, "ana@acme.ch")
	e.signature("sig_expired", "wsp_a", "pending", "", "doc_expired", "", true, "ana@acme.ch")
	e.signature("sig_trashed", "wsp_a", "completed", "fld_acme_docs", "doc_t", "doc_t_signed", false, "ana@acme.ch")
	e.signature("sig_b", "wsp_b", "completed", "", "doc_b", "", false, "ana@acme.ch")

	type row struct {
		ID          string `json:"id"`
		Status      string `json:"status"`
		AwaitingYou bool   `json:"awaiting_you"`
		SignedFile  *struct {
			Name string `json:"name"`
		} `json:"signed_file"`
	}
	listed := func(c *http.Cookie) map[string]row {
		res, out := e.do("GET", "/signatures", nil, c, "")
		if res.StatusCode != 200 {
			t.Fatalf("list: %d %v", res.StatusCode, out)
		}
		got := map[string]row{}
		for _, v := range out["data"].([]any) {
			m := v.(map[string]any)
			r := row{ID: m["id"].(string), Status: m["status"].(string), AwaitingYou: m["awaiting_you"].(bool)}
			if f, ok := m["signed_file"].(map[string]any); ok {
				r.SignedFile = &struct {
					Name string `json:"name"`
				}{f["name"].(string)}
			}
			got[r.ID] = r
		}
		return got
	}
	ids := func(m map[string]row) []string {
		var out []string
		for id := range m {
			out = append(out, id)
		}
		slices.Sort(out)
		return out
	}

	ana, _ := e.signIn("ana@acme.ch")
	got := listed(ana)
	if want := []string{"sig_contract", "sig_expired", "sig_folder", "sig_linked", "sig_loose", "sig_trashed"}; !slices.Equal(ids(got), want) {
		t.Fatalf("Acme sees %v, want %v", ids(got), want)
	}
	if r := got["sig_folder"]; r.Status != "completed" || r.SignedFile == nil || r.SignedFile.Name != "doc_a_signed.pdf" || r.AwaitingYou {
		t.Errorf("completed: %+v", r)
	}
	if !got["sig_linked"].AwaitingYou || got["sig_contract"].AwaitingYou || got["sig_contract"].Status != "pending" {
		t.Errorf("awaiting: linked %+v contract %+v", got["sig_linked"], got["sig_contract"])
	}
	if r := got["sig_expired"]; r.Status != "expired" || r.AwaitingYou {
		t.Errorf("expired: %+v", r)
	}
	if got["sig_trashed"].SignedFile != nil {
		t.Errorf("a trashed signed copy is offered: %+v", got["sig_trashed"])
	}

	res, _ := e.get(ana, "/signatures/sig_folder/download")
	if res.StatusCode != 302 || !strings.HasPrefix(res.Header.Get("Location"), "https://s3.example/obj/doc_a_signed") {
		t.Fatalf("download: %d %v", res.StatusCode, res.Header)
	}
	e.files.proxy = true
	e.files.objects["obj/doc_loose_signed"] = []byte("%PDF-signed")
	if res, body := e.get(ana, "/signatures/sig_loose/download"); res.StatusCode != 200 || body != "%PDF-signed" {
		t.Fatalf("proxied download: %d %q", res.StatusCode, body)
	}
	e.files.proxy = false
	for _, id := range []string{"sig_contract", "sig_trashed", "sig_gamma", "sig_hr", "sig_revoked", "sig_b", "sig_missing"} {
		if res, _ := e.get(ana, "/signatures/"+id+"/download"); res.StatusCode != 404 {
			t.Errorf("download %s: %d", id, res.StatusCode)
		}
	}

	bob, _ := e.signIn("bob@beta.ch")
	if got := ids(listed(bob)); !slices.Equal(got, []string{"sig_gamma"}) {
		t.Fatalf("Gamma sees %v", got)
	}
	if res, _ := e.get(bob, "/signatures/sig_folder/download"); res.StatusCode != 404 {
		t.Fatalf("another client's download: %d", res.StatusCode)
	}

	// Ana's session in the other workspace sees only that workspace's request.
	other, _ := e.signInAt("/w/other", "ana@acme.ch")
	if res, out := e.doAt("/w/other", "GET", "/signatures", nil, other, ""); res.StatusCode != 200 ||
		len(out["data"].([]any)) != 1 || out["data"].([]any)[0].(map[string]any)["id"] != "sig_b" {
		t.Fatalf("other workspace: %d %v", res.StatusCode, out)
	}

	// The shared portal signs nobody in, so it lists nothing.
	if res, _ := e.doAt("", "GET", "/signatures", nil, ana, ""); res.StatusCode != 401 {
		t.Fatalf("unscoped: %d", res.StatusCode)
	}
	if res, _ := e.do("GET", "/signatures", nil, nil, ""); res.StatusCode != 401 {
		t.Fatalf("signed out: %d", res.StatusCode)
	}
}
