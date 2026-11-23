package mail_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"

	"helvetly.com/api/internal/mail"
	"helvetly.com/api/internal/mail/mailtest"
)

func TestLayoutKeepsToSupportedHTML(t *testing.T) {
	brand := mail.Brand{Name: "Muster AG", LogoPath: "/logo", Address: []string{"Weg 1"}, Phone: "+41 44 000 00 00", Email: "a@muster.ch", VAT: "CHE-123.456.789"}
	letter := mail.NewLetter("de").Greeting("Anna").Lead("Hi").Summary(mail.Row{Label: "Document", Value: "Vertrag", Link: "https://x.example/m", LinkText: "Map"}).
		Action("Open", "https://x.example/o").Note("Bring it").FinePrint("Attached")
	body := `<p>Hi <a href="https://x.example">there</a></p><ul><li>One</li></ul>` + letter.HTML()
	for _, m := range []mail.Message{
		{Subject: "Helvetly's own", HTML: body},
		{Subject: "With a footer", HTML: body, Footer: `Why <a href="https://x.example/u" style="color:#71717a">you</a>`},
		{Subject: "Branded", HTML: body, Brand: &brand, Language: "de"},
		{Subject: "Branded, no logo", HTML: body, Brand: &mail.Brand{Name: "X"}},
	} {
		mailtest.Check(t, m.Subject, mail.Layout(m, "https://app.example.com"))
	}
}

// Every caller builds its body fragment from string literals: none of those may bring back what the layout avoids.
func TestEmailSourcesKeepToSupportedHTML(t *testing.T) {
	root := filepath.Join("..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		// mailtest holds the rule itself
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || filepath.Base(filepath.Dir(path)) == "mailtest" {
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
			if ok && lit.Kind == token.STRING && strings.Contains(lit.Value, "<") && mailtest.Unsupported.MatchString(lit.Value) {
				t.Errorf("%s: %q in an HTML literal", fset.Position(lit.Pos()), mailtest.Unsupported.FindString(lit.Value))
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
