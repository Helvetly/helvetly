package portal

import (
	"net/http"
	"strings"

	"helvetly.com/api/internal/store"
)

// A participant's session (portal_sessions.participant_id) reaches only what is theirs: their own sessions (and
// their requests on them), the documents shared with them and, when the client sends invoices and documents to its
// participants, the invoices addressed to them and the signature requests they sign. Everything else of the client
// (its profile, engagements, other people's records, booking as the client) answers 404, so nothing tells them it
// exists. Each route below also filters its own reads by the participant.

// participantRoutes are the patterns a participant's session may use; documents marks those of participants mode.
var participantRoutes = map[string]bool{
	"GET /api/v1/public/portal/session":                          false,
	"POST /api/v1/public/portal/session/client":                  false,
	"DELETE /api/v1/public/portal/session":                       false,
	"GET " + avatarPath:                                          false,
	"PUT " + avatarPath:                                          false,
	"DELETE " + avatarPath:                                       false,
	"GET /api/v1/public/portal/documents":                        false,
	"GET /api/v1/public/portal/documents/{id}/download":          false,
	"GET " + schedBase + "/occurrences":                          false,
	"GET " + schedBase + "/occurrences/{id}/ics":                 false,
	"GET " + schedBase + "/series/{id}/ics":                      false,
	"POST " + schedBase + "/occurrences/{id}/cancel-request":     false,
	"POST " + schedBase + "/occurrences/{id}/reschedule-request": false,
	"POST " + schedBase + "/requests/{id}/accept":                false,
	"POST " + schedBase + "/requests/{id}/decline":               false,
	"DELETE " + schedBase + "/requests/{id}":                     false,
	"GET /api/v1/public/portal/invoices":                         true,
	"GET /api/v1/public/portal/invoices/{id}/pdf":                true,
	"GET /api/v1/public/portal/signatures":                       true,
	"GET /api/v1/public/portal/signatures/{id}/download":         true,
}

// participantAllows: the client's own session may use every route; a participant's only theirs.
func participantAllows(r *http.Request, sess store.PortalSession) bool {
	if sess.ParticipantID == "" {
		return true
	}
	documents, ok := participantRoutes[r.Pattern]
	return ok && (!documents || sess.ParticipantsMode)
}

// participantOwns checks, for a participant's session, that the path's session, series or request is theirs.
func (s *Service) participantOwns(r *http.Request, sess store.PortalSession) error {
	if sess.ParticipantID == "" || !strings.HasPrefix(r.Pattern[strings.IndexByte(r.Pattern, ' ')+1:], schedBase+"/") {
		return nil
	}
	path := strings.TrimPrefix(r.Pattern[strings.IndexByte(r.Pattern, ' ')+1:], schedBase+"/")
	kind := map[string]string{"occurrences": "occurrence", "series": "series", "requests": "request"}[strings.SplitN(path, "/", 2)[0]]
	if r.PathValue("id") == "" || kind == "" {
		return nil
	}
	return s.sched.ParticipantOwns(r.Context(), sess.Workspace, sess.ClientID, sess.ParticipantID, kind, r.PathValue("id"))
}
