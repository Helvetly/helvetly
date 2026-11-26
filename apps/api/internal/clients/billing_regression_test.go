package clients

import (
	"context"
	"testing"
)

func TestChangedProfileDecision(t *testing.T) {
	e := newEnv(t)
	b := e.workspace()
	c := e.create(b, address("Buyer"))
	url := "/api/v1/clients/" + c.ID + "/change-request"
	e.request(b, c.ID, map[string]any{"billing_email": "first@example.test"})
	reviewed := e.reviewed(b, c.ID, map[string]any{"fields": []string{"billing_email"}})
	e.request(b, c.ID, map[string]any{"billing_email": "second@example.test"})
	e.do(b, "POST", url+"/approve", reviewed, 409, nil)
	e.do(b, "POST", url+"/reject", map[string]any{"request_id": reviewed["request_id"], "created_at": reviewed["created_at"]}, 409, nil)
	v, err := e.st.Client(context.Background(), b.workspace, c.ID)
	if err != nil || v.BillingEmail != nil {
		t.Fatalf("%+v %v", v, err)
	}
	e.do(b, "POST", url+"/approve", e.reviewed(b, c.ID, nil), 200, nil)
	v, err = e.st.Client(context.Background(), b.workspace, c.ID)
	if err != nil || v.BillingEmail == nil || *v.BillingEmail != "second@example.test" {
		t.Fatal(v.BillingEmail, err)
	}
}
