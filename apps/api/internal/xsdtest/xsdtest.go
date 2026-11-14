// Package xsdtest validates generated XML against official schemas pinned in a package's testdata, offline.
package xsdtest

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Valid validates doc against schema (a path under dir) with xmllint --nonet, resolving imports through
// dir/catalog.xml. Without xmllint it only logs, unless HELVETLY_TEST_XSD is set (pnpm test:xsd, CI).
func Valid(t testing.TB, dir, schema, name string, doc []byte) {
	t.Helper()
	if _, err := exec.LookPath("xmllint"); err != nil {
		if os.Getenv("HELVETLY_TEST_XSD") != "" {
			t.Fatal("HELVETLY_TEST_XSD is set but xmllint is not installed")
		}
		t.Logf("xmllint not found: %s schema validation not run", filepath.Base(schema))
		return
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, doc, 0o600); err != nil {
		t.Fatal(err)
	}
	catalog, err := filepath.Abs(filepath.Join(dir, "catalog.xml"))
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("xmllint", "--nonet", "--noout", "--schema", filepath.Join(dir, schema), path)
	cmd.Env = append(os.Environ(), "XML_CATALOG_FILES="+catalog)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%s is not valid against %s: %v\n%s\n%s", name, schema, err, out, doc)
	}
}

// Pinned checks every file listed in dir/SHA256SUMS against its pinned hash and returns their paths.
func Pinned(t testing.TB, dir string) []string {
	t.Helper()
	sums, err := os.Open(filepath.Join(dir, "SHA256SUMS"))
	if err != nil {
		t.Fatal(err)
	}
	defer sums.Close()
	var paths []string
	for sc := bufio.NewScanner(sums); sc.Scan(); {
		want, path, _ := strings.Cut(sc.Text(), "  ")
		raw, err := os.ReadFile(filepath.Join(dir, path))
		if err != nil {
			t.Fatal(err)
		}
		if sum := sha256.Sum256(raw); hex.EncodeToString(sum[:]) != want {
			t.Errorf("%s: SHA-256 changed; the pinned official file was modified", path)
		}
		paths = append(paths, path)
	}
	return paths
}
