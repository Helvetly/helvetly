package imports

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uploads"
)

const maxValueChars = 2000 // a value longer than any create rule allows is cut, so stored records stay small

const maxListItems = 200 // e.g. the lines of one invoice

// clean keeps a record's fields of the kind only: nulls, blank strings and values that are not a JSON string, number
// or boolean are dropped, strings trimmed. A property the schema declares as an array of objects (invoice lines)
// keeps a list of flat objects cleaned the same way against the items' properties. It is the boundary for the
// model's output and for a person's edits.
func clean(k Kind, raw map[string]json.RawMessage) Data {
	return cleanObject(k.Schema, raw)
}

func cleanObject(schema map[string]any, raw map[string]json.RawMessage) Data {
	props, _ := schema["properties"].(map[string]any)
	out := Data{}
	for key, v := range raw {
		prop, ok := props[key].(map[string]any)
		if !ok {
			continue
		}
		if items, ok := prop["items"].(map[string]any); ok {
			if list := cleanList(items, v); list != nil {
				out[key] = list
			}
			continue
		}
		if s := scalar(v); s != nil {
			out[key] = s
		}
	}
	return out
}

func cleanList(items map[string]any, v json.RawMessage) json.RawMessage {
	var list []json.RawMessage
	if json.Unmarshal(v, &list) != nil {
		return nil
	}
	kept := []Data{}
	for _, raw := range list {
		var item map[string]json.RawMessage
		if len(kept) == maxListItems {
			break
		}
		if json.Unmarshal(raw, &item) != nil {
			continue
		}
		if d := cleanObject(items, item); len(d) > 0 {
			kept = append(kept, d)
		}
	}
	if len(kept) == 0 {
		return nil
	}
	b, _ := json.Marshal(kept)
	return b
}

// scalar: a trimmed, bounded JSON string, a boolean or a number, or nil.
func scalar(v json.RawMessage) json.RawMessage {
	v = bytes.TrimSpace(v)
	switch {
	case len(v) == 0, string(v) == "null":
		return nil
	case v[0] == '"':
		var s string
		if json.Unmarshal(v, &s) != nil {
			return nil
		}
		if s = strings.TrimSpace(s); s == "" {
			return nil
		}
		if utf8.RuneCountInString(s) > maxValueChars {
			s = string([]rune(s)[:maxValueChars])
		}
		b, _ := json.Marshal(s)
		return b
	case string(v) == "true", string(v) == "false":
		return v
	}
	var n json.Number
	if json.Unmarshal(v, &n) != nil {
		return nil
	}
	return json.RawMessage(n.String())
}

// review fills a record's issues and duplicate hint from its data. seen holds names earlier in the same chunk.
func review(ctx context.Context, q store.Q, k Kind, workspaceID, batchID string, r *store.ImportRecord) error {
	issues, err := k.Check(ctx, q, workspaceID, r.Data)
	if err != nil {
		return err
	}
	if issues == nil {
		issues = map[string]string{}
	}
	r.Issues = issues
	if r.Duplicate, err = k.Duplicate(ctx, q, workspaceID, r.Data); err != nil || r.Duplicate != nil {
		return err
	}
	if name := rawText(r.Data[k.labelField()]); name != "" {
		taken, err := q.ImportNameTaken(ctx, batchID, r.ID, k.labelField(), name)
		if err != nil {
			return err
		}
		if taken {
			r.Duplicate = &store.ImportDuplicate{Label: name, Reason: "same name in this import"}
		}
	}
	return nil
}

func (s *Service) edit(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if len(body.Data) == 0 {
		return invalid("Send the changed fields in data.")
	}
	ctx := r.Context()
	var rec store.ImportRecord
	err := s.db.Tx(ctx, func(q store.Q) error {
		b, k, err := s.batch(ctx, q, sess, r.PathValue("id"), "write")
		if err != nil {
			return err
		}
		fields := k.fields()
		for key := range body.Data {
			if !slices.Contains(fields, key) {
				return invalid("Unknown field " + key + ".")
			}
		}
		if rec, err = q.LockImportRecord(ctx, b.ID, r.PathValue("record_id")); err != nil {
			return err
		}
		if rec.Status == "created" {
			return auth.Error(http.StatusConflict, "invalid_state", "This record has already been created.", nil)
		}
		merged := map[string]json.RawMessage{}
		for key, v := range rec.Data {
			merged[key] = v
		}
		for key, v := range body.Data {
			merged[key] = v
		}
		rec.Data, rec.Status, rec.Error = clean(k, merged), "pending", nil
		if err := review(ctx, q, k, sess.Workspace.ID, b.ID, &rec); err != nil {
			return err
		}
		return q.SaveImportRecord(ctx, rec, s.now())
	})
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": rec})
	return nil
}

type commitResult struct {
	ID       string                `json:"id"`
	Status   string                `json:"status"`
	EntityID *string               `json:"entity_id"`
	Error    *errorBody            `json:"error"`
	Conflict *store.ImportConflict `json:"conflict"`
}

type errorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (s *Service) commit(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	var body struct {
		RecordIDs   []string          `json:"record_ids"`
		Resolutions map[string]string `json:"resolutions"`
	}
	if !s.auth.Decode(w, r, &body) {
		return nil
	}
	if len(body.RecordIDs) == 0 || len(body.RecordIDs) > 500 {
		return invalid("Choose 1 to 500 records.")
	}
	for _, v := range body.Resolutions {
		if v != Overwrite && v != Skip {
			return invalid("A resolution is overwrite or skip.")
		}
	}
	ctx := r.Context()
	b, k, err := s.batch(ctx, s.db.Q, sess, r.PathValue("id"), "write")
	if err != nil {
		return err
	}
	results := []commitResult{}
	for _, id := range slices.Compact(slices.Clone(body.RecordIDs)) {
		res, err := s.commitOne(ctx, sess, k, b.ID, id, body.Resolutions[id])
		if err != nil {
			return err
		}
		results = append(results, res)
	}
	if b, err = s.db.ImportBatch(ctx, sess.Workspace.ID, sess.User.ID, b.ID); err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, map[string]any{"data": map[string]any{"results": results, "batch": b}})
	return nil
}

// commitOne creates one record in its own transaction. The record's row lock makes a retried or concurrent commit
// wait and then see the created entity instead of creating it again. A refusal the person can act on (invalid data,
// a plan limit) is recorded on the record; anything else is an error.
func (s *Service) commitOne(ctx context.Context, sess store.Session, k Kind, batchID, id, resolution string) (commitResult, error) {
	res := commitResult{ID: id, Status: "failed"}
	var refusal *errorBody
	var kept []string // copies Create stored; deleted again when the transaction fails
	err := s.db.Tx(ctx, func(q store.Q) error {
		rec, err := q.LockImportRecord(ctx, batchID, id)
		if err != nil {
			return err
		}
		if rec.Status == "created" {
			res.Status, res.EntityID = "created", rec.EntityID
			return nil
		}
		if done, err := s.skip(ctx, q, &rec, resolution); done || err != nil {
			res.Status = rec.Status
			return err
		}
		if err := review(ctx, q, k, sess.Workspace.ID, batchID, &rec); err != nil {
			return err
		}
		if len(rec.Issues) > 0 {
			refusal = &errorBody{"validation_failed", "Fix the highlighted fields first."}
			msg := refusal.Message
			rec.Status, rec.Error = "failed", &msg
			return q.SaveImportRecord(ctx, rec, s.now())
		}
		src, err := q.ImportRecordSource(ctx, batchID, id)
		if err != nil {
			return err
		}
		keep := func(ctx context.Context, key string) (int64, string, error) {
			b, err := s.read(ctx, store.ImportFile{ObjectKey: src.ObjectKey, EntryIndex: src.EntryIndex})
			if err != nil {
				return 0, "", err
			}
			kept = append(kept, key)
			if err := s.files.Put(ctx, key, bytes.NewReader(b), int64(len(b)), src.ContentType, src.Name); err != nil {
				return 0, "", err
			}
			sum := sha256.Sum256(b)
			return int64(len(b)), hex.EncodeToString(sum[:]), nil
		}
		entity, conflict, err := k.write(ctx, q, sess, rec.Data, Source{DocumentID: src.DocumentID, Name: src.Name,
			ContentType: src.ContentType, Keep: keep}, resolution)
		if err != nil {
			return err
		}
		if conflict != nil { // the record stays pending until the person resolves it
			res.Status, res.Conflict = "conflict", conflict
			return nil
		}
		rec.Status, rec.EntityID, rec.Error = "created", &entity, nil
		if err := q.SaveImportRecord(ctx, rec, s.now()); err != nil {
			return err
		}
		res.Status, res.EntityID = "created", &entity
		return nil
	})
	if err != nil && len(kept) > 0 {
		s.deleteKept(ctx, kept)
	}
	if errors.Is(err, store.ErrNotFound) {
		refusal, err = &errorBody{"not_found", "This record is not part of the import."}, nil
	}
	if status, code, message, ok := auth.Describe(err); ok && status < 500 {
		refusal, err = &errorBody{code, message}, nil
		if serr := s.markFailed(ctx, batchID, id, message); serr != nil {
			return res, serr
		}
	}
	res.Error = refusal
	return res, err
}

func (s *Service) deleteKept(ctx context.Context, keys []string) {
	ctx, cancel := uploads.CleanupContext(ctx)
	defer cancel()
	for _, key := range keys {
		if err := s.files.Delete(ctx, key); err != nil {
			s.log.WarnContext(ctx, "orphaned import copy", "key", key, "error", err)
		}
	}
}

// skip answers a record the person leaves out: marked skipped, and still skipped on a later commit without a
// resolution (idempotent); an overwrite takes a skipped record up again. true when the record is done.
func (s *Service) skip(ctx context.Context, q store.Q, rec *store.ImportRecord, resolution string) (bool, error) {
	switch {
	case resolution == Skip && rec.Status != "skipped":
		rec.Status, rec.Error = "skipped", nil
		return true, q.SaveImportRecord(ctx, *rec, s.now())
	case resolution == Skip, rec.Status == "skipped" && resolution != Overwrite:
		return true, nil
	}
	return false, nil
}

func (s *Service) markFailed(ctx context.Context, batchID, id, message string) error {
	return s.db.Tx(ctx, func(q store.Q) error {
		rec, err := q.LockImportRecord(ctx, batchID, id)
		if err != nil || rec.Status == "created" {
			return err
		}
		rec.Status, rec.Error = "failed", &message
		return q.SaveImportRecord(ctx, rec, s.now())
	})
}
