package mail

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// What Mailpit's HTML Check (caniemail) does not count as supported everywhere: email HTML must keep to the rest.
var unsupportedHTML = regexp.MustCompile(`(?i)<style|<body|<hr|<pre|@media|!important|margin|padding:|border|background|bgcolor|` +
	`\s(width|height)=|[;"]\s*width:|display:|overflow|line-height|font-weight|letter-spacing|text-decoration|text-align|white-space|word-break|` +
	`opacity|:last-child|font:`)

func TestLayoutKeepsToSupportedHTML(t *testing.T) {
	brand := Brand{Name: "Muster AG", LogoPath: "/logo", Address: []string{"Weg 1"}, Phone: "+41 44 000 00 00", Email: "a@muster.ch", VAT: "CHE-123.456.789"}
	body := `<p>Hi <a href="https://x.example">there</a></p><ul><li>One</li></ul>` + Details([2]string{"Document", "Vertrag"}) +
		Button("Open", "https://x.example/o")
	for _, m := range []Message{
		{Subject: "Helvetly's own", HTML: body},
		{Subject: "With a footer", HTML: body, Footer: `Why <a href="https://x.example/u" style="color:#71717a">you</a>`},
		{Subject: "Branded", HTML: body, Brand: &brand, Language: "de"},
		{Subject: "Branded, no logo", HTML: body, Brand: &Brand{Name: "X"}},
	} {
		if got := layout(m, "https://app.example.com"); unsupportedHTML.MatchString(got) {
			t.Errorf("%s: %q in %s", m.Subject, unsupportedHTML.FindString(got), got)
		}
	}
}

// Every caller builds its body fragment from string literals: none of those may bring back what the layout avoids.
func TestEmailSourcesKeepToSupportedHTML(t *testing.T) {
	root := filepath.Join("..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		if !sendsMail(f) && filepath.Base(filepath.Dir(path)) != "mail" {
			return nil
		}
		fset := token.NewFileSet()
		if f, err = parser.ParseFile(fset, path, nil, 0); err != nil {
			return err
		}
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if ok && lit.Kind == token.STRING && strings.Contains(lit.Value, "<") && unsupportedHTML.MatchString(lit.Value) {
				t.Errorf("%s: %q in an HTML literal", fset.Position(lit.Pos()), unsupportedHTML.FindString(lit.Value))
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func sendsMail(f *ast.File) bool {
	for _, i := range f.Imports {
		if i.Path.Value == `"helvetly.com/api/internal/mail"` {
			return true
		}
	}
	return false
}
