package documents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"helvetly.com/api/internal/aimodel"
	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/tags"
)

// AI filing: a file uploaded to Documents by someone who approved AI use in the workspace is tagged by the model and,
// when it was uploaded to the top level, moved into the folder that fits (a new top-level folder when none does).
// It runs after the upload in a job, never blocks it, and leaves the file as it was when it can't run. HR files never
// reach it: they are not uploaded here and are not documents to store.Document.

const (
	// filingLease: a claimed filing comes due again this long after an instance died with it; longer than one
	// Generate (aimodel.MaxAnswerTimeout, counts and retries included).
	filingLease     = 4 * time.Minute
	filingBatch     = 5
	filingTries     = 6
	filingMaxOutput = 300
	filingTextBytes = 6_000   // the start of a text, Word or Excel file is enough to tell what it is
	filingFileBytes = 4 << 20 // larger files are filed by their name
	filingFolders   = 200
	filingAITags    = 3
	maxTags         = 10
	maxTagRunes     = 32
)

const filingInstructions = "You file documents in a small business's document manager. From the file's name, type and " +
	"content, reply with 1 to 3 short lower-case tags (one or two words each, in the language of the document) that say " +
	"what it is, such as invoice, contract, receipt, insurance or payslip; prefer tags already in use when they fit. " +
	"Set folder_id to the id of the listed folder the file belongs in, or, when none fits, folder_id to null and " +
	"new_folder to a short, general top-level folder name (one or two words, Title Case, plural where natural, such as " +
	"Contracts or Insurance, in the language the message names for folders) that more files like it would fit. " + recordRules + " For those, set folder_id to null and " +
	"new_folder to that path. When the message says the file stays in its folder, set both to null. Set " +
	"is_completed_contract to true only for an actual completed contract or agreement (its parties named, dates and key " +
	"terms filled in, no empty lines, blanks or [Name]-style placeholders, not marked as a template, sample or draft), " +
	"else false; contract_reason says why in one short sentence for a contract-like file, else is empty. Set " +
	"is_bank_statement to true only for an account statement of a bank or payment provider (such as UBS, PostFinance, " +
	"Raiffeisen, Revolut or Wise, also CAMT.053 or MT940 files) that lists an account's transactions and balances, " +
	"never for an invoice, receipt or payment slip that only shows an IBAN, else false; for a statement, " +
	"statement_period_end is the last day of the period it covers and statement_date the day it was made " +
	"(YYYY-MM-DD, empty when not given), else both are empty. Use only the given information."

var filingSchema = &aimodel.Schema{Name: "document_filing", JSON: map[string]any{
	"type": "object",
	"properties": map[string]any{
		"tags":                  map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
		"folder_id":             map[string]any{"type": []string{"string", "null"}},
		"new_folder":            map[string]any{"type": []string{"string", "null"}},
		"is_completed_contract": map[string]any{"type": "boolean"},
		"contract_reason":       map[string]any{"type": "string"},
		"is_bank_statement":     map[string]any{"type": "boolean"},
		"statement_period_end":  map[string]any{"type": "string"},
		"statement_date":        map[string]any{"type": "string"},
	},
	"required": []string{"tags", "folder_id", "new_folder", "is_completed_contract", "contract_reason",
		"is_bank_statement", "statement_period_end", "statement_date"},
	"additionalProperties": false,
}}

// SetFiler turns AI filing on: the model, the budget its calls are counted in and how a file's text is read (the
// imports' reader, passed in because imports reaches documents through employees). Without it (no model) uploads
// are never queued for filing.
func (s *Service) SetFiler(p aimodel.Provider, b aimodel.Budget, text func(data []byte, limit int) string) {
	s.filer, s.budget, s.text = p, b, text
}

// errSkip ends a filing without changing anything: the file is gone, or the answer can't be used.
var errSkip = errors.New("nothing to file")

// filingGate refuses a filing call unless whoever uploaded the file is still a member who may write documents, the
// plan includes AI import and they approved AI use in this workspace themselves.
func (s *Service) filingGate(ctx context.Context, q store.Q, workspaceID, userID string) error {
	role, err := q.MemberRole(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	scopes, err := q.MemberScopes(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if !permissions.Allows(role, scopes, "write:documents") {
		return auth.Error(http.StatusForbidden, "forbidden", "The uploader may no longer write documents.", nil)
	}
	if err := q.RequireFeature(ctx, workspaceID, store.FeatureAIImport); err != nil {
		return err
	}
	return auth.RequireAIConsent(ctx, q, workspaceID, userID)
}

// queueFiling queues a new upload for filing when its uploader's gate allows it now; the job checks again before
// each call. Its own transaction after the upload's, so it can never fail the upload. lang is the uploader's, "" for
// none, so the folders filing makes are named in it.
func (s *Service) queueFiling(ctx context.Context, sess store.Session, id string, mayMove bool, lang string) {
	if s.filer == nil {
		return
	}
	err := s.db.Tx(ctx, func(q store.Q) error {
		if err := s.filingGate(ctx, q, sess.Workspace.ID, sess.User.ID); err != nil {
			if _, _, _, refused := auth.Describe(err); refused || errors.Is(err, store.ErrFeatureDenied) || errors.Is(err, store.ErrNotFound) {
				return nil
			}
			return err
		}
		return q.QueueFiling(ctx, sess.Workspace.ID, id, sess.User.ID, mayMove, lang, s.now())
	})
	if err != nil {
		s.log.ErrorContext(ctx, "queue AI filing", "document", id, "error", err)
	}
}

// QueueFiling queues a file stored by another entry point (an import) for filing, as an upload to the top level; its
// folders are named in the workspace's document language.
func (s *Service) QueueFiling(ctx context.Context, sess store.Session, id string) {
	s.queueFiling(ctx, sess, id, true, "")
}

// RunFiling files queued uploads every few seconds until ctx ends; the person who uploaded is waiting for it.
func (s *Service) RunFiling(ctx context.Context) {
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for {
		if err := s.FileDue(ctx); err != nil {
			s.log.ErrorContext(ctx, "AI filing", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}

// FileDue files every due upload; claims make concurrent instances skip each other's.
func (s *Service) FileDue(ctx context.Context) error {
	for {
		due, err := s.db.ClaimFilings(ctx, s.now(), filingLease, filingBatch)
		if err != nil {
			return err
		}
		for _, j := range due {
			s.file(ctx, j)
		}
		if len(due) < filingBatch {
			return nil
		}
	}
}

// filing is the model's decision, checked: at most one of folderID (a live folder listed to it), newFolder and record
// (a place in the system folders).
type filing struct {
	tags                []string
	folderID, newFolder string
	record              *recordPlace
	// the model's verdict on a contract (is_completed_contract, contract_reason), and the reason recorded
	completedContract bool
	contractReason    string
	// the model's verdict on a bank statement (is_bank_statement) and its dates (YYYY-MM-DD, "" when unknown)
	bankStatement            bool
	periodEnd, statementDate string
}

func (s *Service) file(ctx context.Context, j store.FilingJob) {
	err := s.fileOne(ctx, j)
	if err == nil {
		return
	}
	if errors.Is(err, aimodel.ErrUncertain) { // the pool is busy: wait without spending a try, it frees within its stale window
		if rerr := s.db.DeferFiling(ctx, j.DocumentID, s.now().Add(10*time.Second)); rerr != nil {
			s.log.ErrorContext(ctx, "defer AI filing", "document", j.DocumentID, "error", rerr)
		}
		return
	}
	if retryable(err) && j.Attempts < filingTries {
		next := s.now().Add(10 * time.Second << min(j.Attempts-1, 5))
		if rerr := s.db.RetryFiling(ctx, j.DocumentID, next); rerr != nil {
			s.log.ErrorContext(ctx, "retry AI filing", "document", j.DocumentID, "error", rerr)
		}
		return
	}
	// quota used, approval withdrawn, file gone: the file simply stays where it is
	s.log.InfoContext(ctx, "AI filing skipped", "document", j.DocumentID, "workspace", j.WorkspaceID, "reason", err)
	if ferr := s.db.FinishFiling(ctx, j.DocumentID, store.FilingRecord{Status: "skipped"}, s.now()); ferr != nil {
		s.log.ErrorContext(ctx, "record AI filing", "document", j.DocumentID, "error", ferr)
	}
}

// retryable: the provider failed (charged at most its reservation; aimodel's attempts per step stop a second retry),
// or a database or storage error; never a refusal or a used allowance.
func retryable(err error) bool {
	for _, final := range []error{errSkip, aimodel.ErrQuota, aimodel.ErrTooLarge, aimodel.ErrCap,
		aimodel.ErrAttempts, aimodel.ErrUnfunded, store.ErrFeatureDenied, store.ErrNotFound} {
		if errors.Is(err, final) {
			return false
		}
	}
	_, _, _, refused := auth.Describe(err)
	return !refused
}

func (s *Service) fileOne(ctx context.Context, j store.FilingJob) error {
	ws, err := s.db.AdmissionWorkspace(ctx, j.WorkspaceID)
	if err != nil {
		return fmt.Errorf("load workspace: %w", err)
	}
	doc, err := s.db.Document(ctx, ws.ID, j.DocumentID) // never an HR file
	if errors.Is(err, store.ErrNotFound) || err == nil && doc.DeletedAt != nil {
		return errSkip
	}
	if err != nil {
		return err
	}
	mayMove := j.MayMove && doc.FolderID == nil
	var data []byte
	if doc.Size <= filingFileBytes {
		if data, err = s.read(ctx, doc.ObjectKey); err != nil {
			return err
		}
	}
	text := ""
	if data != nil {
		text = s.text(data, filingTextBytes)
	}
	names, err := s.recordNames(ctx, ws.ID)
	if err != nil {
		return err
	}
	index, err := s.recordIndex(ctx, ws.ID, names.clients)
	if err != nil {
		return err
	}
	if m := index.match(doc, text); m != nil { // one of the workspace's own records: no model needed
		if err := s.filingGate(ctx, s.db.Q, ws.ID, j.UserID); err != nil {
			return err
		}
		f := filing{tags: []string{m.tag}}
		if mayMove {
			f.record = &m.place
		}
		return s.applyFiling(ctx, j, ws, f)
	}
	folders := map[string]bool{}
	var listed []store.Folder
	lang := ""
	if mayMove {
		if lang, err = s.folderLanguage(ctx, ws.ID, j.Language); err != nil {
			return err
		}
		all, err := s.db.DocumentFolders(ctx, ws.ID, j.UserID)
		if err != nil {
			return err
		}
		for _, f := range all {
			if !inSystemTree(all, f) && len(listed) < filingFolders {
				listed = append(listed, f)
				folders[f.ID] = true
			}
		}
	}
	used, err := s.db.DocumentTags(ctx, ws.ID, 50)
	if err != nil {
		return err
	}
	req := filingRequest(doc, data, text, mayMove, lang, listed, names, used)
	budget := s.budget
	budget.Gate = func(ctx context.Context, q store.Q, workspaceID string) error {
		return s.filingGate(ctx, q, workspaceID, j.UserID)
	}
	call := aimodel.Call{Kind: "filing", Operation: doc.ID, Step: "file", MaxOutput: filingMaxOutput, Caps: aimodel.FilingCaps,
		Timeout: aimodel.MaxAnswerTimeout}
	reply, err := budget.Generate(ctx, s.filer, ws, req, call)
	if len(req.Files) > 0 && (errors.Is(err, aimodel.ErrCap) || errors.Is(err, aimodel.ErrTooLarge)) {
		// too large to read whole: its name may still say enough
		req.Files, call.Step = nil, "name"
		req.Message = strings.Replace(req.Message, "The file is attached.", "The file is too large to read.", 1)
		reply, err = budget.Generate(ctx, s.filer, ws, req, call)
	}
	if err != nil {
		return err
	}
	decided, err := readFiling(reply.Text, mayMove, folders, names)
	if err != nil {
		return err
	}
	if mayMove && decided.record == nil {
		decided = toClient(decided, doc, listed, index.client(doc, text))
		decided.newFolder = localName(decided.newFolder, lang) // the model may still have named it in the document's language
		// never the bare system folder: Bank Statements/<year> or nowhere
		if statementTag([]string{decided.newFolder}) {
			decided.bankStatement, decided.newFolder = true, ""
		}
	}
	if mayMove && bankStatement(doc, text, decided.bankStatement, decided.tags, decided.record) {
		year := statementYear(decided.periodEnd, decided.statementDate, doc.CreatedAt, ws.Location())
		decided = filing{tags: decided.tags, record: &recordPlace{kind: "bank_statements", year: year}}
	}
	if decided.record != nil && decided.record.contracts {
		ok, reason := completedContract(doc.Name, text, decided.completedContract, decided.contractReason)
		decided.record.contracts, decided.contractReason = ok, reason // not completed: the client's Documents/<year>
	}
	return s.applyFiling(ctx, j, ws, decided)
}

// toClient: an invoice, quote or contract the model filed outside the system folders goes to its client's record
// folder (a contract to its Contracts folder, checked after) when the file names one known client.
func toClient(f filing, doc store.Document, listed []store.Folder, client *store.ClientName) filing {
	if client == nil {
		return f
	}
	var path []string
	if f.newFolder != "" {
		path = []string{f.newFolder}
	} else if i := slices.IndexFunc(listed, func(l store.Folder) bool { return l.ID == f.folderID }); f.folderID != "" && i >= 0 {
		path = strings.Split(folderPath(listed, listed[i]), "/")
	}
	if kind := recordKind(path, f.tags); kind != "" {
		return filing{tags: f.tags, record: &recordPlace{clientID: client.ID, kind: kind, year: recordYear(path, doc)}}
	}
	if isContract(path, f.tags) {
		f.record = &recordPlace{clientID: client.ID, kind: "documents", year: recordYear(path, doc), contracts: true}
		f.folderID, f.newFolder = "", ""
	}
	return f
}

// filingRequest is what the model sees: the file's name and type, its text or the file itself when small, the
// folders it may choose from, the language of new folders and the tags in use.
func filingRequest(doc store.Document, data []byte, text string, mayMove bool, lang string, folders []store.Folder, names recordNames, tags []string) aimodel.Request {
	var msg strings.Builder
	fmt.Fprintf(&msg, "File name: %s\nFile type: %s\n\n", doc.Name, doc.ContentType)
	if mayMove {
		msg.WriteString("Folders:\n")
		for _, f := range folders {
			fmt.Fprintf(&msg, "%s\t%s\n", f.ID, folderPath(folders, f))
		}
		if len(folders) == 0 {
			msg.WriteString("(none yet)\n")
		}
		msg.WriteString(folderLanguageRule(lang) + "\n" + recordList(names) + "\n")
	} else {
		msg.WriteString("The file stays in its folder.\n\n")
	}
	if len(tags) > 0 {
		fmt.Fprintf(&msg, "Tags in use: %s\n\n", strings.Join(tags, ", "))
	}
	req := aimodel.Request{Instructions: filingInstructions, Schema: filingSchema}
	if text != "" {
		msg.WriteString("Text:\n" + text)
	} else if data != nil && attachable(doc.ContentType) {
		msg.WriteString("The file is attached.")
		req.Files = []aimodel.File{{Name: doc.Name, ContentType: doc.ContentType, Bytes: data}}
	}
	req.Message = msg.String()
	return req
}

// attachable: the file types the model reads as files.
func attachable(contentType string) bool {
	return slices.Contains([]string{"application/pdf", "image/png", "image/jpeg", "image/webp"}, contentType)
}

func (s *Service) read(ctx context.Context, key string) ([]byte, error) {
	f, err := s.files.Open(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("open document: %w", err)
	}
	defer f.Close()
	return io.ReadAll(io.LimitReader(f, filingFileBytes+1))
}

// folderPath: "Parent/Child" for a folder among folders.
func folderPath(folders []store.Folder, f store.Folder) string {
	parts := []string{f.Name}
	for seen := 0; f.ParentID != nil && seen < 20; seen++ {
		i := slices.IndexFunc(folders, func(p store.Folder) bool { return p.ID == *f.ParentID })
		if i < 0 {
			break
		}
		f = folders[i]
		parts = append([]string{f.Name}, parts...)
	}
	return strings.Join(parts, "/")
}

// readFiling checks the model's answer: usable tags only, and a folder only among those listed.
func readFiling(text string, mayMove bool, folders map[string]bool, names recordNames) (filing, error) {
	var out struct {
		Tags      []string `json:"tags"`
		FolderID  *string  `json:"folder_id"`
		NewFolder *string  `json:"new_folder"`
		Completed bool     `json:"is_completed_contract"`
		Reason    string   `json:"contract_reason"`
		Statement bool     `json:"is_bank_statement"`
		PeriodEnd string   `json:"statement_period_end"`
		Date      string   `json:"statement_date"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(text)), &out) != nil {
		return filing{}, errSkip
	}
	reason := []rune(strings.Join(strings.Fields(out.Reason), " "))
	f := filing{completedContract: out.Completed, contractReason: string(reason[:min(len(reason), 200)]),
		bankStatement: out.Statement, periodEnd: out.PeriodEnd, statementDate: out.Date}
	for _, t := range out.Tags {
		if tag := tags.Slug(t); tag != "" && len(f.tags) < filingAITags && !slices.Contains(f.tags, tag) {
			f.tags = append(f.tags, tag)
		}
	}
	switch {
	case !mayMove:
	case out.FolderID != nil && folders[*out.FolderID]:
		f.folderID = *out.FolderID
	case out.NewFolder != nil:
		if path, ok := splitPath(*out.NewFolder, organizeApplyDepth); ok {
			if statementTag(path) { // a statement folder, in any language: Bank Statements/<year>
				f.bankStatement = true
				if _, ok := yearOf(path[len(path)-1]); ok && f.periodEnd == "" && f.statementDate == "" {
					f.periodEnd = path[len(path)-1]
				}
				break
			}
			if place, system := recordPath(path, names); system {
				f.record = place // nil: a made-up place in the system folders, so the file stays
				break
			}
		}
		if name, problem := checkName(*out.NewFolder); problem == "" && utf8.RuneCountInString(name) <= 60 {
			f.newFolder = name
		}
	}
	return f, nil
}

// cleanTags: typed tags trimmed, lower-cased and without repeats, each in the tags package's shape, or the reason
// they can't be used.
func cleanTags(raw []string) ([]string, string) {
	out := []string{}
	for _, t := range raw {
		t = strings.ToLower(strings.TrimSpace(t))
		switch {
		case t == "":
			continue
		case !tags.Valid(t):
			return nil, tags.Problem
		case !slices.Contains(out, t):
			out = append(out, t)
		}
	}
	return out, ""
}

const tooManyTags = "Use at most 10 tags."

// restoredTags: the tags an undo puts back as they were, also ones from before the tags' shape (never new input).
func restoredTags(raw []string) ([]string, string) {
	out := []string{}
	for _, t := range raw {
		t = strings.ToLower(strings.Join(strings.Fields(t), " "))
		switch {
		case t == "":
			continue
		case utf8.RuneCountInString(t) > maxTagRunes, strings.ContainsFunc(t, unicode.IsControl):
			return nil, "Keep each tag to 32 characters."
		case !slices.Contains(out, t):
			out = append(out, t)
		}
	}
	if len(out) > maxTags {
		return nil, "Use at most 10 tags."
	}
	return out, ""
}

// applyFiling adds the tags and, when the file is still at the top level it was uploaded to, moves it into the
// chosen folder (made at the top level when new, or the one already there by that name or kind), recording what
// changed.
func (s *Service) applyFiling(ctx context.Context, j store.FilingJob, ws store.Workspace, f filing) error {
	sess := store.Session{Workspace: ws, User: store.User{ID: j.UserID}}
	var rec store.FilingRecord
	err := s.db.Tx(ctx, func(q store.Q) error {
		cur, err := q.Document(ctx, ws.ID, j.DocumentID)
		if errors.Is(err, store.ErrNotFound) || err == nil && cur.DeletedAt != nil {
			return errSkip
		}
		if err != nil {
			return err
		}
		rec = store.FilingRecord{Status: "filed", FromFolderID: cur.FolderID}
		if f.record != nil && f.record.kind == "documents" && f.contractReason != "" {
			rec.ContractReason = &f.contractReason
		}
		for _, t := range f.tags {
			if !slices.Contains(cur.Tags, t) && len(cur.Tags)+len(rec.Tags) < maxTags {
				rec.Tags = append(rec.Tags, t)
			}
		}
		if len(rec.Tags) > 0 {
			if err := q.SetDocumentTags(ctx, ws.ID, cur.ID, append(slices.Clone(cur.Tags), rec.Tags...), s.now()); err != nil {
				return err
			}
		}
		if j.MayMove && cur.FolderID == nil && !cur.MoveLocked(s.today()) {
			target, created, err := s.filingFolder(ctx, q, ws.ID, j.UserID, f)
			if err != nil {
				return err
			}
			if target != "" {
				name, err := s.placeFile(q, ctx, sess, cur.ID, cur.Name, &target, "keep_both")
				if err != nil {
					return err
				}
				if err := q.UpdateDocument(ctx, ws.ID, cur.ID, name, &target, s.now()); err != nil {
					return err
				}
				rec.FolderID, rec.CreatedFolder = &target, created
			}
		}
		if len(rec.Tags) == 0 && rec.FolderID == nil {
			rec.Status = "skipped"
		}
		return q.FinishFiling(ctx, cur.ID, rec, s.now())
	})
	if err == nil && rec.Status == "filed" {
		folder := ""
		if rec.FolderID != nil {
			folder = *rec.FolderID
		}
		s.log.InfoContext(ctx, "AI filed a document", "document", j.DocumentID, "workspace", ws.ID, "folder", folder,
			"created_folder", rec.CreatedFolder, "tags", len(rec.Tags))
	}
	return err
}

// filingFolder: the live folder to move into ("" for none), and whether filing made it (never a system folder).
func (s *Service) filingFolder(ctx context.Context, q store.Q, workspaceID, userID string, f filing) (string, bool, error) {
	if f.record != nil {
		id, err := f.record.folder(ctx, q, workspaceID, userID, s.now())
		return id, false, err
	}
	if f.folderID != "" {
		if _, err := q.DocumentFolder(ctx, workspaceID, f.folderID); errors.Is(err, store.ErrNotFound) {
			return "", false, nil // deleted meanwhile
		} else if err != nil {
			return "", false, err
		}
		return f.folderID, false, nil
	}
	if f.newFolder == "" {
		return "", false, nil
	}
	if err := q.LockContainer(ctx, workspaceID, nil); err != nil {
		return "", false, err
	}
	all, err := q.DocumentFolders(ctx, workspaceID, userID)
	if err != nil {
		return "", false, err
	}
	var top []store.Folder
	for _, f := range all {
		if f.ParentID == nil && f.SystemKind == nil {
			top = append(top, f)
		}
	}
	names := make([]string, len(top))
	for i, f := range top {
		names[i] = f.Name
	}
	if have := sameFolder(f.newFolder, names); have != "" { // "Verträge" when "Contracts" is asked: never a sibling
		return top[slices.Index(names, have)].ID, false, nil
	}
	existing, err := q.FolderNameTaken(ctx, workspaceID, nil, f.newFolder, "")
	if err != nil || existing != "" {
		return existing, false, err
	}
	id := auth.NewID("fld")
	return id, true, q.CreateFolder(ctx, workspaceID, id, f.newFolder, nil, userID, s.now())
}

// undoFiling puts a filed file back where it was uploaded and removes the tags filing added (those still on it);
// a folder filing made goes too once it is empty. Undoing twice is fine.
func (s *Service) undoFiling(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	ctx, id := r.Context(), r.PathValue("id")
	err := s.db.Tx(ctx, func(q store.Q) error {
		rec, err := q.LockFiling(ctx, sess.Workspace.ID, id)
		if err != nil || rec.Status == "undone" {
			return err
		}
		if rec.Status != "filed" {
			return refuse(http.StatusConflict, "not_filed", "AI hasn't filed this file.", nil)
		}
		cur, err := q.Document(ctx, sess.Workspace.ID, id)
		if err != nil {
			return err
		}
		if cur.DeletedAt != nil {
			return errTrashed
		}
		kept := slices.DeleteFunc(slices.Clone(cur.Tags), func(t string) bool { return slices.Contains(rec.Tags, t) })
		if len(kept) != len(cur.Tags) {
			if err := q.SetDocumentTags(ctx, sess.Workspace.ID, id, kept, s.now()); err != nil {
				return err
			}
		}
		if rec.FolderID != nil && cur.FolderID != nil && *cur.FolderID == *rec.FolderID { // not moved on since
			name, err := s.placeFile(q, ctx, sess, id, cur.Name, rec.FromFolderID, "keep_both")
			if err != nil {
				return err
			}
			if err := q.UpdateDocument(ctx, sess.Workspace.ID, id, name, rec.FromFolderID, s.now()); err != nil {
				return err
			}
			if _, err := q.DeleteEmptyFiledFolder(ctx, sess.Workspace.ID, *rec.FolderID); err != nil {
				return err
			}
		}
		return q.UndoFiling(ctx, id, s.now())
	})
	if err != nil {
		return err
	}
	return s.writeDocument(w, r, sess, http.StatusOK, id)
}
