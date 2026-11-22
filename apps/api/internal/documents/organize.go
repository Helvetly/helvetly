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
	"Insurance, Bank Statements/2024. Prefer the existing folders; a new folder path has at most 3 levels separated by /, each a " +
	"short Title Case name, plural where natural. " + recordRules + " folder is the whole path, or an empty string for the " +
	"top level. Give 1 " +
	"to 3 short lower-case tags, the first saying what kind of document it is (such as invoice, contract, receipt, " +
	"insurance or payslip), preferring tags already in use. Set change to false when the document already sits well " +
	"where it is with fitting tags. reason is one short sentence. Use only the given information."

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
			},
			"required":             []string{"document_id", "folder", "tags", "reason", "change"},
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
	docs, err := s.db.OrganizeDocuments(ctx, ws.ID, within, organizeMax)
	if err != nil {
		return err
	}
	names, err := s.recordNames(ctx, ws.ID)
	if err != nil {
		return err
	}
	if len(docs) == 0 {
		auth.WriteJSON(w, http.StatusOK, data(map[string]any{"proposals": []proposal{}, "considered": 0}))
		return nil
	}
	used, err := s.db.DocumentTags(ctx, ws.ID, 50)
	if err != nil {
		return err
	}
	snippets := s.snippets(ctx, docs)
	index, err := s.recordIndex(ctx, ws.ID, names.clients)
	if err != nil {
		return err
	}
	byID, clients := map[string]proposal{}, map[string]store.ClientName{}
	var rest []store.Document // the files no record decides, for the model
	for _, d := range docs {
		if p, ok := matchedProposal(index.match(d, snippets[d.ID]), d, folders, names); ok {
			byID[d.ID] = p
			continue
		}
		if c := index.client(d, snippets[d.ID]); c != nil {
			clients[d.ID] = *c
		}
		rest = append(rest, d)
	}
	considered, err := s.organizeRest(ctx, sess, rest, snippets, folders, names, clients, used, byID)
	if err != nil {
		return err
	}
	proposals := []proposal{}
	for _, d := range docs {
		if p, ok := byID[d.ID]; ok {
			proposals = append(proposals, p)
		}
	}
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"proposals": proposals, "considered": len(docs) - len(rest) + considered}))
	return nil
}

// organizeRest asks the model about the files no record decides and adds its checked proposals to byID; the number of
// files it considered.
func (s *Service) organizeRest(ctx context.Context, sess store.Session, docs []store.Document, snippets map[string]string,
	folders []store.Folder, names recordNames, clients map[string]store.ClientName, used []string, byID map[string]proposal) (int, error) {
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
	reply, err := budget.Generate(ctx, s.filer, ws, organizeRequest(docs, snippets, folders, names, used), call)
	if errors.Is(err, aimodel.ErrCap) || errors.Is(err, aimodel.ErrTooLarge) {
		// too large: fewer documents, by name only
		docs, snippets, call.Step = docs[:min(len(docs), organizeShort)], nil, "short"
		reply, err = budget.Generate(ctx, s.filer, ws, organizeRequest(docs, snippets, folders, names, used), call)
	}
	if err != nil {
		return 0, organizeError(err)
	}
	proposals, err := readOrganize(reply.Text, docs, folders, names, clients)
	if err != nil {
		return 0, err
	}
	for _, p := range proposals {
		byID[p.DocumentID] = p
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

// organizeRequest: the folder tree, the tags in use and one JSON line per document.
func organizeRequest(docs []store.Document, snippets map[string]string, folders []store.Folder, names recordNames, tags []string) aimodel.Request {
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
	msg.WriteString("\n" + recordList(names))
	if len(tags) > 0 {
		fmt.Fprintf(&msg, "\nTags in use: %s\n", strings.Join(tags, ", "))
	}
	msg.WriteString("\nDocuments:\n")
	for _, d := range docs {
		line, _ := json.Marshal(map[string]any{"id": d.ID, "name": d.Name, "type": d.ContentType,
			"folder": currentPath(folders, d.FolderID), "tags": d.Tags, "text": snippets[d.ID]})
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
// client (clients, by document); else its reason says no client was found.
func readOrganize(text string, docs []store.Document, folders []store.Folder, names recordNames, clients map[string]store.ClientName) ([]proposal, error) {
	var out struct {
		Proposals []struct {
			DocumentID string   `json:"document_id"`
			Folder     string   `json:"folder"`
			Tags       []string `json:"tags"`
			Reason     string   `json:"reason"`
			Change     bool     `json:"change"`
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
			if place, system := recordPath(path, names); system && place != nil ||
				!system && (existing[strings.Join(path, "/")] || len(path) <= organizeDepth) {
				p.Folder = strings.Join(path, "/")
			}
		}
		for _, t := range a.Tags {
			if tag := tags.Slug(t); tag != "" && len(p.Tags) < filingAITags && !slices.Contains(p.Tags, tag) {
				p.Tags = append(p.Tags, tag)
			}
		}
		reason := []rune(strings.Join(strings.Fields(a.Reason), " "))
		p.Reason = string(reason[:min(len(reason), 200)])
		change := a.Change
		path, _ := splitPath(p.Folder, organizeApplyDepth)
		if _, system := recordPath(path, names); !system {
			if kind := recordKind(path, p.Tags); kind != "" {
				c, named := clients[d.ID]
				folder, ok := clientRecordPath(names, recordPlace{clientID: c.ID, kind: kind, year: recordYear(path, d)})
				switch {
				case named && ok:
					p.Folder, change = folder, true
					p.Reason = fmt.Sprintf("%s for %s, so it goes in the client's folder.", map[string]string{"invoices": "An invoice", "quotes": "A quote"}[kind], strings.Join(strings.Fields(c.Name), " "))
				case len(path) > 0:
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
	switch {
	case len(body.Items) == 0:
		return validationFailed(map[string]string{"items": "Choose at least one document."})
	case len(body.Items) > organizeMax:
		return validationFailed(map[string]string{"items": "Choose at most 150 documents at a time."})
	}
	paths := make([][]string, len(body.Items))
	for i, it := range body.Items {
		path, ok := splitPath(it.Folder, organizeApplyDepth)
		if !ok {
			return validationFailed(map[string]string{"items": "Use folder names of at most 60 characters, without control characters."})
		}
		typed, problem := cleanTags(it.Tags)
		if problem != "" {
			return validationFailed(map[string]string{"items": problem})
		}
		paths[i], body.Items[i].Tags = path, typed
	}
	ctx, ws := r.Context(), sess.Workspace.ID
	names, err := s.recordNames(ctx, ws)
	if err != nil {
		return err
	}
	moved, tagged := 0, 0
	var undo organizeUndo
	err = s.db.Tx(ctx, func(q store.Q) error {
		moved, tagged, undo = 0, 0, organizeUndo{Previous: []organizePrevious{}, CreatedFolders: []string{}}
		resolved := map[string]*string{"": nil}
		resolve := func(path []string) (*string, error) {
			if place, system := recordPath(path, names); system {
				if place == nil {
					return nil, errSkip
				}
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
		for i, it := range body.Items {
			if seen[it.DocumentID] {
				continue
			}
			seen[it.DocumentID] = true
			cur, err := q.Document(ctx, ws, it.DocumentID)
			if errors.Is(err, store.ErrNotFound) || err == nil && cur.DeletedAt != nil {
				continue
			}
			if err != nil {
				return err
			}
			target, err := resolve(paths[i])
			if errors.Is(err, errSkip) { // not a place in the system folders: the document stays
				continue
			}
			if err != nil {
				return err
			}
			prev := organizePrevious{DocumentID: cur.ID, FolderID: cur.FolderID, Tags: slices.Clone(cur.Tags)}
			changed := false
			if !samePlace(cur.FolderID, target) {
				name, err := s.placeFile(q, ctx, sess, cur.ID, cur.Name, target, "keep_both")
				if err != nil {
					return err
				}
				if err := q.UpdateDocument(ctx, ws, cur.ID, name, target, s.now()); err != nil {
					return err
				}
				moved++
				changed = true
			}
			tags := slices.Clone(cur.Tags)
			for _, t := range it.Tags {
				if !slices.Contains(tags, t) && len(tags) < maxTags {
					tags = append(tags, t)
				}
			}
			if len(tags) != len(cur.Tags) {
				if err := q.SetDocumentTags(ctx, ws, cur.ID, tags, s.now()); err != nil {
					return err
				}
				tagged++
				changed = true
			}
			if changed {
				undo.Previous = append(undo.Previous, prev)
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.log.InfoContext(ctx, "AI organize applied", "workspace", ws, "moved", moved, "tagged", tagged,
		"created_folders", len(undo.CreatedFolders))
	auth.WriteJSON(w, http.StatusOK, data(map[string]any{"moved": moved, "tagged": tagged, "undo": undo}))
	return nil
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
