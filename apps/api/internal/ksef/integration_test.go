package ksef

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"fmt"
	"math/big"
	"os"
	"strings"
	"testing"
	"time"
)

// randomNIP: a NIP with a valid check digit and no real taxpayer behind it, as the KSeF TEST rules require.
func randomNIP(t *testing.T) string {
	for {
		n, err := rand.Int(rand.Reader, big.NewInt(900_000_000))
		if err != nil {
			t.Fatal(err)
		}
		d := fmt.Sprintf("%09d", n.Int64()+100_000_000)
		sum := 0
		for i, w := range []int{6, 5, 7, 2, 3, 4, 5, 6, 7} {
			sum += w * int(d[i]-'0')
		}
		if sum%11 < 10 && d[1:3] != "00" {
			return d + fmt.Sprint(sum%11)
		}
	}
}

// TestKSeFTestEnvironment sends one synthetic FA(3) invoice to the public KSeF TEST environment, which accepts
// self-signed certificates and random NIPs (no real taxpayer data). Opt-in: HELVETLY_TEST_KSEF=1; never in CI.
func TestKSeFTestEnvironment(t *testing.T) {
	if os.Getenv("HELVETLY_TEST_KSEF") == "" {
		t.Skip("HELVETLY_TEST_KSEF not set: the public KSeF TEST environment is not called")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	nip := randomNIP(t)
	tp := New("https://api-test.ksef.mf.gov.pl/v2", nil).For(Credentials{NIP: nip, Certificate: selfSigned(t, key, nip), Key: key})
	sample, err := os.ReadFile("testdata/sample-fa3.xml")
	if err != nil {
		t.Fatal(err)
	}
	today := time.Now().UTC().Format(time.DateOnly)
	invoice := strings.NewReplacer("5250001233", nip, "7010004569", randomNIP(t), "FV/2026/11/0042", "TEST/"+nip+"/"+today, "2026-11-07", today,
		"2026-11-09T10:00:00Z", time.Now().UTC().Format(time.RFC3339)).Replace(string(sample))

	r, err := tp.Submit(ctx, []byte(invoice))
	if err != nil {
		t.Fatal(err)
	}
	var st Status
	for !st.Done {
		if st, err = tp.Status(ctx, r); err != nil {
			t.Fatal(err)
		}
		if !st.Done {
			time.Sleep(2 * time.Second)
		}
	}
	if !st.Accepted {
		t.Fatalf("KSeF refused the invoice: %d %s %v", st.Code, st.Description, st.Details)
	}
	t.Logf("accepted as %s", st.KSeFNumber)
	if upo, err := tp.UPO(ctx, r); err != nil || len(upo) == 0 {
		t.Fatalf("UPO: %v", err)
	}
}
