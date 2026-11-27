package documents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

// AI organize: on request, the model proposes a folder path and tags for up to organizeMax documents at once; nothing
// changes until the person applies the rows they approve, and an applied run can be undone. HR files never reach it:
// they never pass store.Document.

const (
	organizeMax        = 150
	organizeShort      = 60 // documents in the retry without text when the full request is too large
	organizeSnippet    = 400
	organizeDepth      = 3  // levels the model may propose for a new folder path
	organizeApplyDepth = 20 // levels an applied path may have (an existing deep folder)
	organizeMaxOutput  = 16_000
	organizeReaders    = 8
	maxFolderRunes     = 60
)

const organizeInstructions = "You organize a small business's document manager. For each listed document (a JSON " +
	"line with its id, name, file type, current folder path, tags and the start of its text), propose the folder path it " +
	"belongs in and its tags. Keep a calm, conventional structure, such as by kind and then year: Contracts/2025, " +
	"Insurance, Bank Statements/2024. Prefer the existing folders, whatever their language; a new folder path has at most 3 levels separated by /, each a " +
	"short Title Case name, plural where natural, in the language the message names for folders. " + recordRules + " folder is the whole path, or an empty string for the " +
	"top level. Give 1 " +
	"to 3 short lower-case tags, the first saying what kind of document it is (such as invoice, contract, receipt, " +
	"insurance or payslip), preferring tags already in use. Set change to false when the document already sits well " +
	"where it is with fitting tags. An existing contract tag on a client's document is enough to propose its Contracts " +
	"folder, unless its name marks it as a template, sample or draft. reason is one short sentence. " + kindRule +
	" Use only the given information."

var organizeSchema = &aimodel.Schema{Name: "document_organize", JSON: map[string]any{
	"type": "object",
	"properties": map[string]any{
		"proposals": map[string]any{"type": "array", "items": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"document_id": map[string]any{"type": "string"},
				"folder":      map[string]any{"type": "string"},
				"tags":        map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
				"reason":      map[string]any{"type": "string"},
				"change":      map[string]any{"type": "boolean"},
				"kind":        kindSchema,
			},
			"required":             []string{"document_id", "folder", "tags", "reason", "change", "kind"},
			"additionalProperties": false,
		}},
	},
	"required":             []string{"proposals"},
	"additionalProperties": false,
}}

type proposal struct {
	DocumentID string   `json:"document_id"`
	Name       string   `json:"name"`
	FromFolder *string  `json:"from_folder"`
	Folder     string   `json:"folder"`
	Tags       []string `json:"tags"`
	Reason     string   `json:"reason"`
	Change     bool     `json:"change"`
}

func (s *Service) registerOrganize(handle func(string, handler)) {
	handle("POST /api/v1/documents/organize", s.organize)
	handle("POST /api/v1/documents/organize/apply", s.organizeApply)
	handle("POST /api/v1/documents/organize/undo", s.organizeUndo)
}

func (s *Service) organize(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		FolderID *string `json:"folder_id"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if s.filer == nil {
		return auth.Error(http.StatusServiceUnavailable, "ai_unavailable", "AI isn't available on this server.", nil)
	}
	ctx, ws := r.Context(), sess.Workspace
	if err := s.filingGate(ctx, s.db.Q, ws.ID, sess.User.ID); err != nil {
		return err
	}
	folders, err := s.db.DocumentFolders(ctx, ws.ID, sess.User.ID)
	if err != nil {
		return err
	}
	var within []string
	if body.FolderID != nil {
		if !slices.ContainsFunc(folders, func(f store.Folder) bool { return f.ID == *body.FolderID }) {
			return validationFailed(map[string]string{"folder_id": "This folder doesn't exist any more."})
		}
		for _, f := range folders {
			if inSubtree(folders, f, *body.FolderID) {
				within = append(within, f.ID)
			}
		}
	}
	docs, err := s.db.OrganizeDocuments(ctx, ws.ID, within, organizeMax, s.today())
	if err != nil {
		return err
	}
	proposals, considered, err := s.propose(ctx, sess, requestLanguage(r), docs, folders)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"proposals": proposals, "considered": considered}))
	return nil
}

// propose finds where each document belongs: a record it is decides, else the model; the proposals in docs' order and
// the number of documents considered. New folders are named in the asker's language (lang).
func (s *Service) propose(ctx context.Context, sess store.Session, lang string, docs []store.Document, folders []store.Folder) ([]proposal, int, error) {
	ws := sess.Workspace
	names, err := s.recordNames(ctx, ws.ID)
	if err != nil {
		return nil, 0, err
	}
	if len(docs) == 0 {
		return []proposal{}, 0, nil
	}
	used, err := s.db.DocumentTags(ctx, ws.ID, 50)
	if err != nil {
		return nil, 0, err
	}
	snippets := s.snippets(ctx, docs)
	index, err := s.recordIndex(ctx, ws.ID, names.clients)
	if err != nil {
		return nil, 0, err
	}
	byID, clients, numbers := map[string]proposal{}, map[string]store.ClientName{}, map[string]recordMatch{}
	var rest []store.Document // the files no record decides, for the model
	for _, d := range docs {
		m := index.match(d, snippets[d.ID])
		if m != nil && m.identity {
			if p, ok := matchedProposal(m, d, folders, names); ok {
				byID[d.ID] = p
				continue
			}
		}
		if m != nil { // a record number names the client; a payment of it goes to its Bank Statements
			if i := slices.IndexFunc(names.clients, func(c store.ClientName) bool { return c.ID == m.place.clientID }); i >= 0 {
				clients[d.ID] = names.clients[i]
			}
			if kind, ordinal, paid := m.paid(d); paid {
				if p, ok := paidProposal(*m, d, folders, names, kind, ordinal, ws.Location()); ok {
					byID[d.ID] = p
					continue
				}
			}
			numbers[d.ID] = *m
		} else if c := index.client(d, snippets[d.ID]); c != nil {
			clients[d.ID] = *c
		}
		rest = append(rest, d)
	}
	lang, err = s.folderLanguage(ctx, ws.ID, lang)
	if err != nil {
		return nil, 0, err
	}
	considered, err := s.organizeRest(ctx, sess, lang, rest, snippets, folders, names, clients, numbers, used, byID)
	if err != nil {
		return nil, 0, err
	}
	proposals := []proposal{}
	for _, d := range docs {
		if p, ok := byID[d.ID]; ok {
			proposals = append(proposals, p)
		}
	}
	return proposals, len(docs) - len(rest) + considered, nil
}

// organizeRest asks the model about the files no record decides and adds its checked proposals to byID, new folders
// named in lang; the number of files it considered.
func (s *Service) organizeRest(ctx context.Context, sess store.Session, lang string, docs []store.Document, snippets map[string]string,
	folders []store.Folder, names recordNames, clients map[string]store.ClientName, numbers map[string]recordMatch, used []string,
	byID map[string]proposal) (int, error) {
	if len(docs) == 0 {
		return 0, nil
	}
	ws := sess.Workspace
	budget := s.budget
	budget.Gate = func(ctx context.Context, q store.Q, workspaceID string) error {
		return s.filingGate(ctx, q, workspaceID, sess.User.ID)
	}
	call := aimodel.Call{Kind: "organize", Operation: auth.NewID("org"), Step: "organize", MaxOutput: organizeMaxOutput,
		Caps: aimodel.OrganizeCaps}
	reply, err := budget.Generate(ctx, s.filer, ws, organizeRequest(docs, snippets, folders, names, numbers, used, lang), call)
	if errors.Is(err, aimodel.ErrCap) || errors.Is(err, aimodel.ErrTooLarge) {
		// too large: fewer documents, by name only
		docs, snippets, call.Step = docs[:min(len(docs), organizeShort)], nil, "short"
		reply, err = budget.Generate(ctx, s.filer, ws, organizeRequest(docs, snippets, folders, names, numbers, used, lang), call)
	}
	if err != nil {
		return 0, organizeError(err)
	}
	proposals, err := readOrganize(reply.Text, docs, folders, names, clients, lang)
	if err != nil {
		return 0, err
	}
	for _, p := range proposals {
		i := slices.IndexFunc(docs, func(d store.Document) bool { return d.ID == p.DocumentID })
		var named *store.ClientName
		if c, ok := clients[p.DocumentID]; ok {
			named = &c
		}
		p = statementProposal(p, docs[i], snippets[p.DocumentID], names, named, ws.Location())
		p = taxProposal(p, docs[i], snippets[p.DocumentID], names, ws.Location())
		if m, ok := numbers[p.DocumentID]; ok { // named by number: a payment of the record, else the record as before
			if len(p.Tags) > 0 && clientStatementKind(p.Tags[0]) {
				p.Reason = m.paidReason(p.Tags[0], "")
			} else if mp, ok := matchedProposal(&m, docs[i], folders, names); ok {
				p = mp
			}
		}
		byID[p.DocumentID] = p
	}
	for _, d := range docs { // named by number, unanswered: the record, as before
		if m, ok := numbers[d.ID]; ok && byID[d.ID].DocumentID == "" {
			if p, ok := matchedProposal(&m, d, folders, names); ok {
				byID[d.ID] = p
			}
		}
	}
	return len(docs), nil
}

// matchedProposal: the proposal for a file a record decides: its client's record folder with the record's kind tag.
func matchedProposal(m *recordMatch, d store.Document, folders []store.Folder, names recordNames) (proposal, bool) {
	if m == nil {
		return proposal{}, false
	}
	folder, ok := clientRecordPath(names, m.place)
	if !ok {
		return proposal{}, false // the client's name is not one record path can name: the model decides
	}
	from := currentPath(folders, d.FolderID)
	p := proposal{DocumentID: d.ID, Name: d.Name, Folder: folder, Tags: []string{m.tag}, Reason: m.reason}
	if d.FolderID != nil {
		p.FromFolder = &from
	}
	p.Change = folder != from || !slices.Contains(d.Tags, m.tag)
	if !p.Change {
		p.Folder = from
	}
	return p, true
}

// paidProposal: the proposal for a payment confirmation or bank statement of a record the file names by number: the
// client's Documents/<year>/Bank Statements (the year its folder or name says, else the upload's in zone) with its kind.
func paidProposal(m recordMatch, d store.Document, folders []store.Folder, names recordNames, kind, ordinal string, zone *time.Location) (proposal, bool) {
	from := currentPath(folders, d.FolderID)
	p := proposal{DocumentID: d.ID, Name: d.Name, Folder: from, Tags: []string{kind}, Change: true}
	if d.FolderID != nil {
		p.FromFolder = &from
	}
	client := store.ClientName{ID: m.place.clientID, Name: m.client}
	p = statementProposal(p, d, "", names, &client, zone)
	if !strings.HasSuffix(p.Folder, "/"+store.BankStatementsFolderName) {
		return proposal{}, false // the client's name is not one a record path can name: the model decides
	}
	p.Reason = m.paidReason(kind, ordinal)
	p.Change = p.Folder != from || !slices.Contains(d.Tags, kind)
	if !p.Change {
		p.Folder = from
	}
	return p, true
}

// inSubtree: f is root or below it.
func inSubtree(folders []store.Folder, f store.Folder, root string) bool {
	for seen := 0; seen < 20; seen++ {
		if f.ID == root {
			return true
		}
		if f.ParentID == nil {
			return false
		}
		i := slices.IndexFunc(folders, func(p store.Folder) bool { return p.ID == *f.ParentID })
		if i < 0 {
			return false
		}
		f = folders[i]
	}
	return false
}

// snippets: the start of each document's text (files up to filingFileBytes), read a few at a time; a file that can't
// be read is organized by its name.
func (s *Service) snippets(ctx context.Context, docs []store.Document) map[string]string {
	out := map[string]string{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, organizeReaders)
	for _, d := range docs {
		if d.Size > filingFileBytes {
			continue
		}
		wg.Go(func() {
			slots <- struct{}{}
			defer func() { <-slots }()
			b, err := s.read(ctx, d.ObjectKey)
			if err != nil {
				s.log.WarnContext(ctx, "read document to organize", "document", d.ID, "error", err)
				return
			}
			text := []rune(strings.Join(strings.Fields(s.text(b, filingTextBytes)), " "))
			if len(text) > 0 {
				mu.Lock()
				out[d.ID] = string(text[:min(len(text), organizeSnippet)])
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	return out
}

func currentPath(folders []store.Folder, id *string) string {
	if id == nil {
		return ""
	}
	i := slices.IndexFunc(folders, func(f store.Folder) bool { return f.ID == *id })
	if i < 0 {
		return ""
	}
	return folderPath(folders, folders[i])
}

// organizeRequest: the folder tree, the language of new folders, the tags in use and one JSON line per document.
func organizeRequest(docs []store.Document, snippets map[string]string, folders []store.Folder, names recordNames,
	numbers map[string]recordMatch, tags []string, lang string) aimodel.Request {
	var msg strings.Builder
	msg.WriteString("Folders:\n")
	paths := make([]string, 0, len(folders))
	for _, f := range folders {
		paths = append(paths, folderPath(folders, f))
	}
	slices.Sort(paths)
	for _, p := range paths[:min(len(paths), filingFolders)] {
		msg.WriteString(p + "\n")
	}
	if len(paths) == 0 {
		msg.WriteString("(none yet)\n")
	}
	msg.WriteString(folderLanguageRule(lang) + "\n" + recordList(names))
	if len(tags) > 0 {
		fmt.Fprintf(&msg, "\nTags in use: %s\n", strings.Join(tags, ", "))
	}
	msg.WriteString("\nDocuments:\n")
	for _, d := range docs {
		item := map[string]any{"id": d.ID, "name": d.Name, "type": d.ContentType,
			"folder": currentPath(folders, d.FolderID), "tags": d.Tags, "text": snippets[d.ID]}
		if m, ok := numbers[d.ID]; ok {
			item["record"] = m.hint()
		}
		line, _ := json.Marshal(item)
		msg.Write(line)
		msg.WriteString("\n")
	}
	return aimodel.Request{Instructions: organizeInstructions, Schema: organizeSchema, Message: msg.String()}
}

// organizeError turns the budget's refusals into answers the page can show; the gate's own errors pass as they are.
func organizeError(err error) error {
	switch {
	case errors.Is(err, aimodel.ErrQuota), errors.Is(err, aimodel.ErrTooLarge):
		return auth.Error(http.StatusForbidden, "quota_exceeded", "This workspace has used its monthly AI import and filing allowance.", nil)
	case errors.Is(err, aimodel.ErrCap), errors.Is(err, aimodel.ErrAttempts):
		return auth.Error(http.StatusRequestEntityTooLarge, "organize_too_large", "There are too many documents to organize at once. Organize one folder at a time.", nil)
	case errors.Is(err, aimodel.ErrUnfunded):
		return auth.Error(http.StatusServiceUnavailable, "ai_unavailable", "AI organizing is paused while the service's AI budget is being updated.", nil)
	case errors.Is(err, aimodel.ErrUncertain):
		return auth.Error(http.StatusServiceUnavailable, "ai_busy", "Another AI request is in progress for this workspace. Try again in a moment.", nil)
	case aimodel.Busy(err):
		return auth.Error(http.StatusServiceUnavailable, "ai_busy", "The AI is busy right now. Try again in a minute.", nil)
	case errors.Is(err, aimodel.ErrProvider):
		return auth.Error(http.StatusServiceUnavailable, "ai_failed", "The AI couldn't organize the documents right now. Nothing was changed. Try again in a moment.", nil)
	}
	return err
}

// readOrganize checks the model's answer: only listed documents, each once, a usable path and tags.
// An invoice or quote outside the system folders goes to its client's record folder when the file names one known
// client (clients, by document), a contract to its Contracts folder; else its reason says no client was found. A new
// plain folder is named in lang, and an existing one of the same kind in another language is proposed instead.
func readOrganize(text string, docs []store.Document, folders []store.Folder, names recordNames, clients map[string]store.ClientName, lang string) ([]proposal, error) {
	var out struct {
		Proposals []struct {
			DocumentID string   `json:"document_id"`
			Folder     string   `json:"folder"`
			Tags       []string `json:"tags"`
			Reason     string   `json:"reason"`
			Change     bool     `json:"change"`
			Kind       string   `json:"kind"`
		} `json:"proposals"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(text)), &out) != nil {
		return nil, auth.Error(http.StatusBadGateway, "ai_unreadable", "The AI model's answer could not be read. Try again.", nil)
	}
	existing := map[string]bool{}
	for _, f := range folders {
		existing[folderPath(folders, f)] = true
	}
	answers := map[string]int{}
	for i, p := range out.Proposals {
		if _, seen := answers[p.DocumentID]; !seen {
			answers[p.DocumentID] = i
		}
	}
	proposals := []proposal{}
	for _, d := range docs { // in the order asked
		i, ok := answers[d.ID]
		if !ok {
			continue
		}
		a := out.Proposals[i]
		from := currentPath(folders, d.FolderID)
		p := proposal{DocumentID: d.ID, Name: d.Name, Folder: from, Tags: []string{}}
		if d.FolderID != nil {
			p.FromFolder = &from
		}
		if path, ok := splitPath(a.Folder, organizeApplyDepth); ok && a.Change {
			// a place in the system folders only by their structure; any other path as before
			place, system := recordPath(path, names)
			if !system {
				path = localPath(path, folders, lang)
			}
			if system && place != nil ||
				!system && (existing[strings.Join(path, "/")] || len(path) <= organizeDepth) {
				p.Folder = strings.Join(path, "/")
				if place != nil && place.contracts {
					// a template, sample or draft is no contract: the client's Documents/<year> instead
					if ok, why := completedContract(d.Name, "", true, ""); !ok {
						p.Folder, a.Reason = strings.Join(path[:4], "/"), why
					}
				}
			}
		}
		free, kind := modelTags(a.Tags, a.Kind)
		if kind != "" { // proposed first, like a record's kind; applying records it as the file's kind
			free = append([]string{kind}, free[:min(len(free), filingAITags-1)]...)
		}
		p.Tags = free
		reason := []rune(strings.Join(strings.Fields(a.Reason), " "))
		p.Reason = string(reason[:min(len(reason), 200)])
		change := a.Change
		path, _ := splitPath(p.Folder, organizeApplyDepth)
		taggedContract := slices.ContainsFunc(d.Tags, func(tag string) bool { return folderKind(tag) == "contracts" })
		if taggedContract {
			if ok, _ := completedContract(d.Name, "", true, ""); ok {
				// Prefer the current client's year when the file is already filed under Documents.
				current, _ := splitPath(from, organizeApplyDepth)
				if place, _ := recordPath(current, names); place != nil && place.kind == "documents" {
					path = current
				}
				if place, _ := recordPath(path, names); place != nil && place.kind == "documents" {
					path = append(path[:4], store.ContractsFolderName)
					p.Folder, change = strings.Join(path, "/"), true
					p.Reason = "Tagged as a contract, so it belongs in the client's Contracts folder."
				}
			}
		}
		if _, system := recordPath(path, names); !system {
			kind, contract := recordKind(path, p.Tags), false
			if kind == "" && (taggedContract || isContract(path, p.Tags)) {
				kind, contract = "documents", true
			}
			if kind != "" {
				c, named := clients[d.ID]
				folder, ok := clientRecordPath(names, recordPlace{clientID: c.ID, kind: kind, year: recordYear(path, d)})
				switch {
				case named && ok && contract:
					p.Folder, change = folder, true
					p.Reason = fmt.Sprintf("A contract with %s, so it goes in the client's folder.", strings.Join(strings.Fields(c.Name), " "))
					if done, why := completedContract(d.Name, "", true, ""); done {
						p.Folder += "/" + store.ContractsFolderName
					} else {
						p.Reason = why // a template, sample or draft: the client's Documents/<year>
					}
				case named && ok:
					p.Folder, change = folder, true
					p.Reason = fmt.Sprintf("%s for %s, so it goes in the client's folder.", map[string]string{"invoices": "An invoice", "quotes": "A quote"}[kind], strings.Join(strings.Fields(c.Name), " "))
				case len(path) > 0 && !contract: // a contract of nobody listed is any other file
					p.Reason = strings.TrimSpace(p.Reason + " No known client could be found in it, so it stays outside Clients.")
				}
			}
		}
		p.Change = change && (p.Folder != from || slices.ContainsFunc(p.Tags, func(t string) bool { return !slices.Contains(d.Tags, t) }))
		if !p.Change {
			p.Folder = from
		}
		proposals = append(proposals, p)
	}
	return proposals, nil
}

// splitPath: a folder path's names ("" is the top level), each a valid folder name, at most depth of them.
func splitPath(raw string, depth int) ([]string, bool) {
	path := []string{}
	for _, seg := range strings.Split(raw, "/") {
		if strings.TrimSpace(seg) == "" {
			continue
		}
		name, problem := checkName(seg)
		if problem != "" || utf8.RuneCountInString(name) > maxFolderRunes {
			return nil, false
		}
		path = append(path, name)
	}
	return path, len(path) <= depth
}

type organizeItem struct {
	DocumentID string   `json:"document_id"`
	Folder     string   `json:"folder"`
	Tags       []string `json:"tags"`
}

type organizePrevious struct {
	DocumentID string   `json:"document_id"`
	FolderID   *string  `json:"folder_id"`
	Tags       []string `json:"tags"`
	Kind       string   `json:"kind"` // the kind AI filing or organizing had recorded (store.Document.FiledKind)
}

type organizeUndo struct {
	Previous       []organizePrevious `json:"previous"`
	CreatedFolders []string           `json:"created_folders"`
}

// organizeApply moves and tags the approved documents in one transaction, making the missing folders of each path;
// documents gone meanwhile (or never of this workspace) are skipped. Tags are added, never removed.
func (s *Service) organizeApply(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Items []organizeItem `json:"items"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if len(body.Items) == 0 {
		return validationFailed(map[string]string{"items": "Choose at least one document."})
	}
	paths, err := checkItems(body.Items)
	if err != nil {
		return err
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	names, err := s.recordNames(ctx, ws)
	if err != nil {
		return err
	}
	var moved, tagged int
	var undo organizeUndo
	err = s.db.Tx(ctx, func(q store.Q) error {
		var err error
		moved, tagged, undo, err = s.applyItems(ctx, q, sess, body.Items, paths, names)
		return err
	})
	if err != nil {
		return err
	}
	s.log.InfoContext(ctx, "AI organize applied", "workspace", ws, "moved", moved, "tagged", tagged,
		"created_folders", len(undo.CreatedFolders))
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"moved": moved, "tagged": tagged, "undo": undo}))
	return nil
}

// checkItems validates applied rows (their tags cleaned in place) and returns each one's folder path.
func checkItems(items []organizeItem) ([][]string, error) {
	if len(items) > organizeMax {
		return nil, validationFailed(map[string]string{"items": "Choose at most 150 documents at a time."})
	}
	paths := make([][]string, len(items))
	for i, it := range items {
		path, ok := splitPath(it.Folder, organizeApplyDepth)
		if !ok {
			return nil, validationFailed(map[string]string{"items": "Use folder names of at most 60 characters, without control characters."})
		}
		typed, problem := cleanTags(it.Tags)
		if problem == "" && len(typed) > maxTags {
			problem = tooManyTags
		}
		if problem != "" {
			return nil, validationFailed(map[string]string{"items": problem})
		}
		paths[i], items[i].Tags = path, typed
	}
	return paths, nil
}

// applyItems moves each document to its path (making the missing folders) and adds its tags, its kind tag recorded as
// its kind, in q's transaction; what changed and how to undo it.
func (s *Service) applyItems(ctx context.Context, q store.Q, sess store.Session, items []organizeItem, paths [][]string,
	names recordNames) (moved, tagged int, undo organizeUndo, err error) {
	ws := sess.Workspace.ID
	undo = organizeUndo{Previous: []organizePrevious{}, CreatedFolders: []string{}}
	resolved := map[string]*string{"": nil}
	resolve := func(path []string) (*string, error) {
		place, system := recordPath(path, names)
		if place != nil {
			id, err := place.folder(ctx, q, ws, sess.User.ID, s.now())
			return &id, err
		}
		var parent *string
		for i, name := range path {
			key := strings.ToLower(strings.Join(path[:i+1], "/"))
			if id, ok := resolved[key]; ok {
				parent = id
				continue
			}
			if err := q.LockContainer(ctx, ws, parent); err != nil {
				return nil, err
			}
			id, err := q.FolderNameTaken(ctx, ws, parent, name, "")
			if err != nil {
				return nil, err
			}
			if id == "" {
				if system {
					return nil, errSkip
				}
				id = auth.NewID("fld")
				if err := q.CreateFolder(ctx, ws, id, name, parent, sess.User.ID, s.now()); err != nil {
					return nil, err
				}
				undo.CreatedFolders = append(undo.CreatedFolders, id)
			}
			parent = &id
			resolved[key] = parent
		}
		return parent, nil
	}
	seen := map[string]bool{}
	for i, it := range items {
		if seen[it.DocumentID] {
			continue
		}
		seen[it.DocumentID] = true
		cur, err := q.Document(ctx, ws, it.DocumentID)
		if errors.Is(err, store.ErrNotFound) || err == nil && cur.DeletedAt != nil {
			continue
		}
		if err != nil {
			return 0, 0, undo, err
		}
		target, err := resolve(paths[i])
		if errors.Is(err, errSkip) { // not a place in the system folders: the document stays
			continue
		}
		if err != nil {
			return 0, 0, undo, err
		}
		prev := organizePrevious{DocumentID: cur.ID, FolderID: cur.FolderID, Tags: slices.Clone(cur.Tags), Kind: cur.FiledKind}
		changed := false
		if !samePlace(cur.FolderID, target) {
			name, err := s.placeFile(q, ctx, sess, cur.ID, cur.Name, target, "keep_both")
			if err != nil {
				return 0, 0, undo, err
			}
			if err := q.UpdateDocument(ctx, ws, cur.ID, name, target, s.now()); err != nil {
				return 0, 0, undo, err
			}
			moved++
			changed = true
		}
		if i := slices.IndexFunc(it.Tags, tags.Kind); i >= 0 && it.Tags[i] != cur.FiledKind {
			if err := q.SetDocumentKind(ctx, ws, cur.ID, it.Tags[i], s.now()); err != nil {
				return 0, 0, undo, err
			}
			tagged++
			changed = true
		}
		next := slices.Clone(cur.Tags)
		for _, t := range it.Tags {
			if !tags.Protected(t) && !slices.Contains(next, t) && len(next) < maxTags {
				next = append(next, t)
			}
		}
		if len(next) != len(cur.Tags) {
			if err := q.SetDocumentTags(ctx, ws, cur.ID, next, s.now()); err != nil {
				return 0, 0, undo, err
			}
			tagged++
			changed = true
		}
		if changed {
			undo.Previous = append(undo.Previous, prev)
		}
	}
	return moved, tagged, undo, nil
}

func samePlace(a, b *string) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }

// organizeUndo puts each document back in its previous folder (the top level when that is gone) with its previous
// tags, then deletes the folders the run made once they are empty, deepest first. Undoing twice is fine.
func (s *Service) organizeUndo(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body organizeUndo
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if len(body.Previous) > organizeMax || len(body.CreatedFolders) > organizeMax*organizeApplyDepth {
		return validationFailed(map[string]string{"previous": "Undo at most 150 documents at a time."})
	}
	for i, p := range body.Previous {
		restored, problem := restoredTags(p.Tags)
		if problem != "" {
			return validationFailed(map[string]string{"previous": problem})
		}
		body.Previous[i].Tags = restored
		if p.Kind != "" && !tags.Kind(p.Kind) {
			return validationFailed(map[string]string{"previous": "Use one of the document kinds."})
		}
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	restored, deleted := 0, 0
	err := s.db.Tx(ctx, func(q store.Q) error {
		restored, deleted = 0, 0
		for _, p := range body.Previous {
			cur, err := q.Document(ctx, ws, p.DocumentID)
			if errors.Is(err, store.ErrNotFound) || err == nil && cur.DeletedAt != nil {
				continue
			}
			if err != nil {
				return err
			}
			folder := p.FolderID
			if folder != nil {
				if _, err := q.DocumentFolder(ctx, ws, *folder); errors.Is(err, store.ErrNotFound) {
					folder = nil
				} else if err != nil {
					return err
				}
			}
			changed := false
			if !samePlace(cur.FolderID, folder) {
				name, err := s.placeFile(q, ctx, sess, cur.ID, cur.Name, folder, "keep_both")
				if err != nil {
					return err
				}
				if err := q.UpdateDocument(ctx, ws, cur.ID, name, folder, s.now()); err != nil {
					return err
				}
				changed = true
			}
			if cur.FiledKind != p.Kind {
				if err := q.SetDocumentKind(ctx, ws, cur.ID, p.Kind, s.now()); err != nil {
					return err
				}
				changed = true
			}
			if !slices.Equal(cur.Tags, p.Tags) {
				if err := q.SetDocumentTags(ctx, ws, cur.ID, p.Tags, s.now()); err != nil {
					return err
				}
				changed = true
			}
			if changed {
				restored++
			}
		}
		for _, id := range slices.Backward(body.CreatedFolders) { // made parent first
			done, err := q.DeleteEmptyFolder(ctx, ws, id)
			if err != nil {
				return err
			}
			if done {
				deleted++
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]int{"restored": restored, "deleted_folders": deleted}))
	return nil
}
