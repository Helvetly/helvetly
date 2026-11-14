package documents

import "testing"

type sharesOut struct {
	Data []struct {
		ClientID   string `json:"client_id"`
		ClientName string `json:"client_name"`
	}
}

func TestShareAndList(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	d := e.uploaded(b, "a.pdf", pdf)
	cli := e.client(b, "Acme")
	path := "/api/v1/documents/" + d.ID + "/shares"
	e.do(b, "POST", path, map[string]any{"client_id": cli}, 204, nil)
	e.do(b, "POST", path, map[string]any{"client_id": cli}, 204, nil) // twice: no-op
	var out sharesOut
	e.do(b, "GET", path, nil, 200, &out)
	if len(out.Data) != 1 || out.Data[0].ClientID != cli || out.Data[0].ClientName != "Acme" {
		t.Fatalf("shares = %+v", out)
	}
	e.fails(b, "DELETE", path, nil, 400, "invalid_request")
	e.do(b, "DELETE", path+"?client_id="+cli, nil, 204, nil)
	e.do(b, "DELETE", path+"?client_id="+cli, nil, 204, nil) // not shared: still 204
	e.do(b, "GET", path, nil, 200, &out)
	if len(out.Data) != 0 {
		t.Fatalf("after unshare = %+v", out)
	}
}

func TestShareNotFound(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	d := e.uploaded(b, "a.pdf", pdf)
	cli := e.client(b, "Acme")
	other := e.workspace()
	foreign := e.client(other, "Foreign")
	e.fails(b, "POST", "/api/v1/documents/"+d.ID+"/shares", map[string]any{"client_id": "cli_missing"}, 404, "not_found")
	e.fails(b, "POST", "/api/v1/documents/"+d.ID+"/shares", map[string]any{"client_id": foreign}, 404, "not_found")
	e.fails(b, "POST", "/api/v1/documents/doc_missing/shares", map[string]any{"client_id": cli}, 404, "not_found")
	e.fails(other, "POST", "/api/v1/documents/"+d.ID+"/shares", map[string]any{"client_id": foreign}, 404, "not_found")
	e.fails(b, "POST", "/api/v1/documents/"+d.ID+"/shares", map[string]any{}, 422, "validation_failed")
	e.do(b, "POST", "/api/v1/documents/"+d.ID+"/trash-me", nil, 404, nil)
}
