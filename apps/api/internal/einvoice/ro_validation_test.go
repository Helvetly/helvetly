package einvoice

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const ciusRODir = "testdata/cius-ro"

func TestCIUSROArtefactsArePinned(t *testing.T) {
	f, err := os.Open(filepath.Join(ciusRODir, "SHA256SUMS"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	lines := 0
	for s := bufio.NewScanner(f); s.Scan(); lines++ {
		want, name, ok := strings.Cut(s.Text(), "  ")
		if !ok {
			t.Fatalf("bad SHA256SUMS line %q", s.Text())
		}
		body, err := os.ReadFile(filepath.Join(ciusRODir, name))
		if err != nil {
			t.Fatal(err)
		}
		if sum := sha256.Sum256(body); hex.EncodeToString(sum[:]) != want {
			t.Errorf("%s changed: its SHA-256 no longer matches the official file", name)
		}
	}
	if lines < 7 {
		t.Fatalf("SHA256SUMS lists %d files, want the rules and the examples", lines)
	}
}

// TestCIUSROSchematron runs ANAF's CIUS-RO Schematron over our output when HELVETLY_TEST_CIUS_RO names the validator
// (scripts/validate-einvoice.sh): it compiles the rules once and writes one SVRL report per XML file.
func TestCIUSROSchematron(t *testing.T) {
	validator := os.Getenv("HELVETLY_TEST_CIUS_RO")
	if validator == "" {
		t.Log("HELVETLY_TEST_CIUS_RO not set: official CIUS-RO validation not run")
		return
	}
	in, out := t.TempDir(), t.TempDir()
	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(in, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("eur.xml", mustUBL(t, roInvoice(), "ro_cius"))
	write("ron-bucharest.xml", mustUBL(t, roBucharest(), "ro_cius"))
	write("credit.xml", mustUBL(t, roCreditNote(), "ro_cius"))
	// Negative control: the county removed after rendering must be caught by BR-RO-111.
	write("no-county.xml", strings.Replace(mustUBL(t, roInvoice(), "ro_cius"), "<cbc:CountrySubentity>RO-CJ</cbc:CountrySubentity>", "", 1))
	// Positive control: ANAF's own 2022 examples, raised to the current specification identifier.
	for _, name := range []string{"eInvoice_ex.xml", "creditNote_ex.xml"} {
		body, err := os.ReadFile(filepath.Join(ciusRODir, "examples", name))
		if err != nil {
			t.Fatal(err)
		}
		write("anaf-"+name, strings.Replace(string(body), "CIUS-RO:1.0.0", "CIUS-RO:1.0.1", 1))
	}
	if report, err := exec.Command(validator, in, out).CombinedOutput(); err != nil {
		t.Fatalf("CIUS-RO validator: %v\n%s", err, report)
	}
	entries, _ := os.ReadDir(in)
	for _, e := range entries {
		errs := svrlErrors(t, filepath.Join(out, e.Name()+".svrl"))
		if e.Name() == "no-county.xml" {
			if !slices.Contains(errs, "BR-RO-111") {
				t.Errorf("no-county.xml: errors %v, want BR-RO-111", errs)
			}
			continue
		}
		if len(errs) > 0 {
			t.Errorf("%s: CIUS-RO errors %v", e.Name(), errs)
		}
	}
}

// svrlErrors: the ids of the failed assertions and fired reports that are not warnings.
func svrlErrors(t *testing.T, path string) []string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("SVRL report: %v", err)
	}
	var report struct {
		Results []struct {
			XMLName xml.Name
			ID      string `xml:"id,attr"`
			Flag    string `xml:"flag,attr"`
		} `xml:",any"`
	}
	if err := xml.Unmarshal(body, &report); err != nil {
		t.Fatalf("SVRL report %s: %v", path, err)
	}
	var ids []string
	for _, r := range report.Results {
		if (r.XMLName.Local == "failed-assert" || r.XMLName.Local == "successful-report") && r.Flag != "warning" {
			ids = append(ids, r.ID)
		}
	}
	return ids
}
