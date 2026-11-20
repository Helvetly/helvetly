package documents

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"helvetly.com/api/internal/store"
)

// Record paths: AI filing and organizing put a client's records into Clients/<client>/<record type>/<year> and
// expenses into Expenses/<year>[/<category>], the system folders, instead of folders of their own.

const filingClients = 200

// recordRules: what the model is told about the system folders.
const recordRules = "Documents of one of the listed clients (issued to them or received from them) that are an " +
	"invoice, credit or debit note, quote, engagement report or contract, signed document or other client document go " +
	"to the path Clients/<the client's name exactly as listed>/<Invoices, Quotes, Engagements, Signatures or " +
	"Documents>/<the year of the document's date>. Receipts, supplier bills and other expenses go to Expenses/<the year " +
	"of their date>. Never make other folders inside Clients or Expenses."

// recordPlace: where a record path points; client "" for Expenses.
type recordPlace struct {
	clientID, kind string
	year           int
	rest           []string // Expenses/<year>/<rest>
}

// recordPath reads a path into the system folders; ok false when it does not start with Clients or Expenses, and
// place nil when it does but does not fit their structure (or names no single listed client).
func recordPath(path []string, clients []store.ClientName) (place *recordPlace, ok bool) {
	if len(path) == 0 {
		return nil, false
	}
	root := strings.ToLower(path[0])
	if root != "clients" && root != "expenses" {
		return nil, false
	}
	if root == "expenses" {
		if len(path) < 2 {
			return nil, true
		}
		year, good := yearOf(path[1])
		if !good || len(path) > 3 {
			return nil, true
		}
		return &recordPlace{kind: "expenses", year: year, rest: path[2:]}, true
	}
	if len(path) != 4 {
		return nil, true
	}
	kind := ""
	for k, name := range store.RecordFolders {
		if strings.EqualFold(name, path[2]) {
			kind = k
		}
	}
	year, good := yearOf(path[3])
	if kind == "" || !good {
		return nil, true
	}
	match := ""
	for _, c := range clients {
		if strings.EqualFold(strings.Join(strings.Fields(c.Name), " "), path[1]) {
			if match != "" {
				return nil, true // two clients by that name: not ours to guess
			}
			match = c.ID
		}
	}
	if match == "" {
		return nil, true
	}
	return &recordPlace{clientID: match, kind: kind, year: year}, true
}

func yearOf(s string) (int, bool) {
	y, err := strconv.Atoi(s)
	return y, err == nil && len(s) == 4 && y >= 1900 && y <= 2200
}

// folder: the system folder of the place, made where missing. Run it in a transaction.
func (p recordPlace) folder(ctx context.Context, q store.Q, workspaceID, userID string, now time.Time) (string, error) {
	if p.clientID != "" {
		return q.ClientRecordFolder(ctx, workspaceID, p.clientID, p.kind, p.year, userID, now)
	}
	return q.FolderPath(ctx, workspaceID, userID, append([]string{store.SystemRoots["expenses"], strconv.Itoa(p.year)}, p.rest...), now)
}

// clientList: the listed clients for the model, one name per line.
func clientList(clients []store.ClientName) string {
	var b strings.Builder
	b.WriteString("Clients:\n")
	for _, c := range clients {
		fmt.Fprintf(&b, "%s\n", strings.Join(strings.Fields(c.Name), " "))
	}
	if len(clients) == 0 {
		b.WriteString("(none yet)\n")
	}
	return b.String()
}

// inSystemTree: f is a system folder or below one; the model files there only by a record path.
func inSystemTree(folders []store.Folder, f store.Folder) bool {
	for seen := 0; seen < 20; seen++ {
		if f.SystemKind != nil {
			return true
		}
		if f.ParentID == nil {
			return false
		}
		i := -1
		for j, p := range folders {
			if p.ID == *f.ParentID {
				i = j
			}
		}
		if i < 0 {
			return false
		}
		f = folders[i]
	}
	return false
}
