package documents

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// A group's ZIP holds at most this much (Service.zipFiles, zipBytes); a bigger group is refused with the reason,
// before anything is read. Up to maxStreamBytes it streams; above, it is built in the background (zip_exports.go),
// under the same caps: the build keeps a temporary copy on the instance's disk.
const (
	maxZipFiles    = 1000
	maxZipBytes    = 500 << 20
	maxStreamBytes = 5 << 20
)

// typeNames: the type groups' names in a ZIP's folders (the app names them in the reader's language on screen).
var typeNames = map[string]string{"invoices": "Invoices", "quotes": "Quotes", "credit_notes": "Credit notes",
	"receipts": "Receipts", "contracts": "Contracts", "engagements": "Engagements",
	"payment_confirmations": "Payment confirmations", "consents": "Consents", "powers_of_attorney": "Powers of attorney",
	"other": "Other"}

// groupDims: the ?group= dimensions (type, year, client: one to three, each once).
func groupDims(r *http.Request) ([]string, error) {
	raw := r.URL.Query().Get("group")
	if raw == "" {
		return nil, nil
	}
	dims := strings.Split(raw, ",")
	for i, d := range dims {
		if !slices.Contains(store.GroupDims, d) || slices.Contains(dims[:i], d) {
			return nil, badRequest("group is a list of type, year and client, each once.")
		}
	}
	return dims, nil
}

// fixed: whether f already narrows to one group of dim.
func fixed(f store.DocumentFilter, dim string) bool {
	switch dim {
	case "type":
		return f.Type != ""
	case "year":
		return f.Year != 0
	default:
		return f.Client != ""
	}
}

// groups answers one level of a grouped view: the groups of the first dimension the filter does not fix yet, with
// their files counted; once every dimension is fixed, the page of files of that group, as the list answers it.
func (s *Service) groups(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	dims, err := groupDims(r)
	if err != nil {
		return err
	}
	if len(dims) == 0 {
		return badRequest("group is required.")
	}
	f, err := listFilter(r, sess)
	if err != nil {
		return err
	}
	for _, dim := range dims {
		if fixed(f, dim) {
			continue
		}
		groups, err := s.db.DocumentGroups(r.Context(), sess.Workspace.ID, f, dim)
		if err != nil {
			return err
		}
		sortGroups(dim, groups)
		auth.WriteJSON(w, http.StatusOK, data(map[string]any{"by": dim, "groups": groups}))
		return nil
	}
	page, size, err := paging(r)
	if err != nil {
		return err
	}
	return s.writePage(w, r, sess, f, page, size)
}

// sortGroups: types in their own order, years newest first, clients by name with "No client" last.
func sortGroups(dim string, groups []store.DocumentGroup) {
	slices.SortStableFunc(groups, func(a, b store.DocumentGroup) int {
		switch dim {
		case "type":
			return slices.Index(store.DocumentTypes, a.Key) - slices.Index(store.DocumentTypes, b.Key)
		case "year":
			return strings.Compare(b.Key, a.Key)
		}
		if (a.Key == store.NoClient) != (b.Key == store.NoClient) {
			if a.Key == store.NoClient {
				return 1
			}
			return -1
		}
		return strings.Compare(strings.ToLower(a.Label), strings.ToLower(b.Label))
	})
}

// groupZip streams the files of a group (the same filters as the list) as one ZIP, in folders for what the group
// leaves open (by client when the client is not chosen). An export: audited, never counted as storage. Above
// zipStream bytes it is built in the background instead (queueZip). With check=1 it only answers whether it would
// stream (204), would be built in the background (200, async), or the refusal.
func (s *Service) groupZip(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	dims, f, files, total, err := s.zipSelection(r, sess)
	if err != nil {
		return err
	}
	async := total > s.zipStream
	if r.URL.Query().Get("check") == "1" { // the app asks first, so a refusal reads as a message, not a broken download
		if async {
			auth.WriteJSON(w, http.StatusOK, data(map[string]any{"async": true, "files": len(files), "bytes": total}))
			return nil
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
	if async {
		return refuse(http.StatusConflict, "zip_async", "This ZIP is too big to download at once; it is prepared in the background.",
			map[string]any{"max_bytes": s.zipStream})
	}
	if err := s.db.Tx(r.Context(), func(q store.Q) error {
		return s.logExport(r.Context(), q, sess.Workspace.ID, sess.User.ID, map[string]any{"group": dims, "type": f.Type,
			"year": f.Year, "client": f.Client, "files": len(files), "bytes": total})
	}); err != nil {
		return err
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+zipName(f)+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	if err := s.writeZip(r.Context(), w, files, dims, f); err != nil {
		s.log.ErrorContext(r.Context(), "group zip failed while streaming", "error", err)
		panic(http.ErrAbortHandler) // a cut connection, so a partial ZIP never looks complete
	}
	return nil
}

// zipSelection: the group's dimensions, filter and files with their total size, or the refusal: none, or more than
// a ZIP holds.
func (s *Service) zipSelection(r *http.Request, sess store.Session) ([]string, store.DocumentFilter, []store.GroupedFile, int64, error) {
	dims, err := groupDims(r)
	if err != nil {
		return nil, store.DocumentFilter{}, nil, 0, err
	}
	f, err := listFilter(r, sess)
	if err != nil {
		return nil, f, nil, 0, err
	}
	files, total, err := s.zipFilesOf(r.Context(), sess.Workspace.ID, f)
	return dims, f, files, total, err
}

// zipFilesOf: the files of f for a ZIP and their total size, refused when there are none or too many.
func (s *Service) zipFilesOf(ctx context.Context, workspaceID string, f store.DocumentFilter) ([]store.GroupedFile, int64, error) {
	files, err := s.db.GroupedFiles(ctx, workspaceID, f, s.zipFiles+1)
	if err != nil {
		return nil, 0, err
	}
	var total int64
	for _, file := range files {
		total += file.Size
	}
	switch {
	case len(files) == 0:
		return nil, 0, refuse(http.StatusUnprocessableEntity, "empty", "There are no files in this group.", nil)
	case len(files) > s.zipFiles || total > s.zipBytes:
		return nil, 0, refuse(http.StatusRequestEntityTooLarge, "zip_too_large", fmt.Sprintf(
			"A ZIP holds at most %d files and %d MB. Open a smaller group (a year or a client) and download that.",
			s.zipFiles, s.zipBytes>>20), map[string]any{"max_files": s.zipFiles, "max_bytes": s.zipBytes})
	}
	return files, total, nil
}

// logExport audits a ZIP of documents (documents.exported) in q's transaction.
func (s *Service) logExport(ctx context.Context, q store.Q, workspaceID, userID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: workspaceID, Kind: "documents.exported",
		SubjectType: "workspace", SubjectID: workspaceID, ActorID: &userID, At: s.now(), Payload: raw})
}

// writeZip writes files into one ZIP on w, at their zipPaths.
func (s *Service) writeZip(ctx context.Context, w io.Writer, files []store.GroupedFile, dims []string, f store.DocumentFilter) error {
	z := zip.NewWriter(w)
	paths := zipPaths(files, dims, f)
	for i, file := range files {
		if err := s.addToZip(ctx, z, paths[i], file.ObjectKey); err != nil {
			return err
		}
	}
	return z.Close()
}

// addToZip copies one stored object into z. A ZIP is only ever complete: an object storage no longer has refuses
// it (a *problem), any other failure to read is an error worth a retry.
func (s *Service) addToZip(ctx context.Context, z *zip.Writer, name, key string) error {
	body, err := s.files.Open(ctx, key)
	if errors.Is(err, store.ErrNotFound) {
		s.log.WarnContext(ctx, "group zip: stored file missing", "path", name, "error", err)
		return refuse(http.StatusConflict, "file_missing", fmt.Sprintf(
			"%s is missing from storage, so the ZIP would be incomplete. Contact support.", path.Base(name)), map[string]any{"path": name})
	}
	if err != nil {
		return fmt.Errorf("open %s: %w", name, err)
	}
	defer body.Close()
	entry, err := z.Create(name)
	if err == nil {
		_, err = io.Copy(entry, body)
	}
	return err
}

// zipPaths: each file's path in the ZIP: a folder for each grouping dimension the filter leaves open, then one for
// the client (when neither the grouping nor the filter has one), then its name; made safe and unique.
func zipPaths(files []store.GroupedFile, dims []string, f store.DocumentFilter) []string {
	open := []string{}
	for _, dim := range dims {
		if !fixed(f, dim) {
			open = append(open, dim)
		}
	}
	if !slices.Contains(dims, "client") && f.Client == "" {
		open = append(open, "client")
	}
	taken := map[string]bool{}
	out := make([]string, len(files))
	for i, file := range files {
		parts := []string{}
		for _, dim := range open {
			parts = append(parts, safeName(groupName(file, dim)))
		}
		dir := strings.Join(parts, "/")
		name := unique(path.Join(dir, safeName(file.Name)), taken)
		out[i] = name
	}
	return out
}

func groupName(file store.GroupedFile, dim string) string {
	switch dim {
	case "type":
		return typeNames[file.Type]
	case "year":
		return strconv.Itoa(file.Year)
	}
	if file.Client == store.NoClient {
		return "No client"
	}
	if file.ClientName == "" {
		return "Deleted client"
	}
	return file.ClientName
}

// safeName: one path segment of a stored name: no separators, control characters or leading dots.
func safeName(name string) string {
	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r == ':' || unicode.IsControl(r) {
			return '_'
		}
		return r
	}, name)
	name = strings.TrimSpace(strings.TrimLeft(name, ". "))
	if name == "" {
		return "file"
	}
	return name
}

// unique: p, or "name (2).ext" and so on when an earlier file took it (ignoring case, as most file systems do).
func unique(p string, taken map[string]bool) string {
	ext := path.Ext(p)
	base := strings.TrimSuffix(p, ext)
	for n, candidate := 2, p; ; n++ {
		if !taken[strings.ToLower(candidate)] {
			taken[strings.ToLower(candidate)] = true
			return candidate
		}
		candidate = base + " (" + strconv.Itoa(n) + ")" + ext
	}
}

// zipName: the download's file name, from the group's keys (ASCII only, so every browser keeps it).
func zipName(f store.DocumentFilter) string {
	parts := []string{"documents"}
	if f.Type != "" {
		parts = append(parts, strings.ReplaceAll(f.Type, "_", "-"))
	}
	if f.Year != 0 {
		parts = append(parts, strconv.Itoa(f.Year))
	}
	if f.Client == store.NoClient {
		parts = append(parts, "no-client")
	}
	return strings.Join(parts, "-") + ".zip"
}
