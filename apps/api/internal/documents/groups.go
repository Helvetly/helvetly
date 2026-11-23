package documents

import (
	"archive/zip"
	"encoding/json"
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
// before anything is read.
const (
	maxZipFiles = 1000
	maxZipBytes = 500 << 20
)

// typeNames: the type groups' names in a ZIP's folders (the app names them in the reader's language on screen).
var typeNames = map[string]string{"invoices": "Invoices", "quotes": "Quotes", "credit_notes": "Credit notes",
	"receipts": "Receipts", "contracts": "Contracts", "engagements": "Engagements", "other": "Other"}

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
// leaves open (by client when the client is not chosen). An export: audited, never counted as storage. With
// check=1 it only answers whether it would (204, or the refusal).
func (s *Service) groupZip(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	dims, err := groupDims(r)
	if err != nil {
		return err
	}
	f, err := listFilter(r, sess)
	if err != nil {
		return err
	}
	files, err := s.db.GroupedFiles(r.Context(), sess.Workspace.ID, f, s.zipFiles+1)
	if err != nil {
		return err
	}
	var total int64
	for _, file := range files {
		total += file.Size
	}
	switch {
	case len(files) == 0:
		return refuse(http.StatusUnprocessableEntity, "empty", "There are no files in this group.", nil)
	case len(files) > s.zipFiles || total > s.zipBytes:
		return refuse(http.StatusRequestEntityTooLarge, "zip_too_large", fmt.Sprintf(
			"A ZIP holds at most %d files and %d MB. Open a smaller group (a year or a client) and download that.",
			s.zipFiles, s.zipBytes>>20), map[string]any{"max_files": s.zipFiles, "max_bytes": s.zipBytes})
	}
	if r.URL.Query().Get("check") == "1" { // the app asks first, so a refusal reads as a message, not a broken download
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
	payload, err := json.Marshal(map[string]any{"group": dims, "type": f.Type, "year": f.Year, "client": f.Client,
		"files": len(files), "bytes": total})
	if err != nil {
		return err
	}
	actor := sess.User.ID
	if err := s.db.Tx(r.Context(), func(q store.Q) error {
		return q.LogEvent(r.Context(), store.FinancialEvent{WorkspaceID: sess.Workspace.ID, Kind: "documents.exported",
			SubjectType: "workspace", SubjectID: sess.Workspace.ID, ActorID: &actor, At: s.now(), Payload: payload})
	}); err != nil {
		return err
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+zipName(f)+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	z := zip.NewWriter(w)
	paths := zipPaths(files, dims, f)
	for i, file := range files {
		if err := s.addToZip(r, z, paths[i], file.ObjectKey); err != nil {
			s.log.ErrorContext(r.Context(), "group zip failed while streaming", "error", err)
			panic(http.ErrAbortHandler) // a cut connection, so a partial ZIP never looks complete
		}
	}
	if err := z.Close(); err != nil {
		panic(http.ErrAbortHandler)
	}
	return nil
}

// addToZip copies one stored object into z; an object storage no longer has is left out (and logged), as the
// workspace export does.
func (s *Service) addToZip(r *http.Request, z *zip.Writer, name, key string) error {
	body, err := s.files.Open(r.Context(), key)
	if err != nil {
		if r.Context().Err() != nil {
			return r.Context().Err()
		}
		s.log.WarnContext(r.Context(), "group zip: stored file not readable", "path", name, "error", err)
		return nil
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
