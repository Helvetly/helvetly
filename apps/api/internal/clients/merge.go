package clients

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// "Make participant of…" (POST /clients/{id}/make-participant): a person client becomes a participant of a company
// client. With dry_run it only says what would move and whom it matched; otherwise, in one transaction holding both
// clients' locks, it finds (or makes) the person at the company, fills what that person lacks from the client, moves
// every record over (store.MergeClientIntoParticipant), deletes the person client and logs one new audit event.
// Owners and admins only, as it deletes a client. A repeat after it is done answers the same result.

var (
	errMergeSource = validationFailed(map[string]string{"id": "Only a person client can become a participant."})
	errMergeTarget = validationFailed(map[string]string{"company_id": "Choose another client that is a company."})
)

type mergeResult struct {
	DryRun        bool              `json:"dry_run"`
	Done          bool              `json:"done"` // it was merged before (a repeat)
	CompanyID     string            `json:"company_id"`
	ParticipantID string            `json:"participant_id"` // "" in a dry run that would add a new person
	Match         string            `json:"match"`          // chosen, email, name or new
	Counts        store.MergeCounts `json:"counts"`
	// SuggestParticipants: the moved invoices were addressed to the person, so the company may want participants mode.
	SuggestParticipants bool `json:"suggest_participants_mode"`
}

func (s *Service) makeParticipant(w http.ResponseWriter, r *http.Request, sess store.Session) error {
	if !canDelete(sess) {
		return auth.Error(http.StatusForbidden, "forbidden", "Only owners and admins can make a client a participant.", nil)
	}
	var in struct {
		CompanyID     string `json:"company_id"`
		ParticipantID string `json:"participant_id"`
		DryRun        bool   `json:"dry_run"`
	}
	if !s.auth.Decode(w, r, &in) {
		return nil
	}
	if in.CompanyID == "" {
		return validationFailed(map[string]string{"company_id": "Choose a company client."})
	}
	res, err := s.merge(r.Context(), sess, r.PathValue("id"), in.CompanyID, in.ParticipantID, in.DryRun)
	if err != nil {
		return err
	}
	auth.WriteJSON(w, http.StatusOK, data(res))
	return nil
}

func (s *Service) merge(ctx context.Context, sess store.Session, sourceID, companyID, participantID string, dryRun bool) (mergeResult, error) {
	res := mergeResult{DryRun: dryRun, CompanyID: companyID, ParticipantID: participantID}
	ws := sess.Workspace.ID
	err := s.db.Tx(ctx, func(q store.Q) error {
		if sourceID == companyID {
			return errMergeTarget
		}
		// a fixed lock order: two merges of the same pair never wait on each other
		first, second := sourceID, companyID
		if second < first {
			first, second = second, first
		}
		for _, id := range []string{first, second} {
			if _, err := q.LockClient(ctx, ws, id); err != nil {
				return err
			}
		}
		source, err := q.Client(ctx, ws, sourceID)
		if errors.Is(err, store.ErrNotFound) {
			target, participant, merr := q.MergedInto(ctx, ws, sourceID)
			if merr == nil && target == companyID {
				res.Done, res.ParticipantID, res.Match = true, participant, "done"
				return nil
			}
			return err
		}
		if err != nil {
			return err
		}
		company, err := q.Client(ctx, ws, companyID)
		if errors.Is(err, store.ErrNotFound) {
			return errMergeTarget
		}
		if err != nil {
			return err
		}
		if source.IsCompany {
			return errMergeSource
		}
		if !company.IsCompany {
			return errMergeTarget
		}
		if res.Counts, err = q.ClientMergeCounts(ctx, ws, sourceID); err != nil {
			return err
		}
		res.SuggestParticipants = company.DocumentsTo != "participants" && res.Counts.PersonBuyer > 0
		var person *store.Contact
		res.Match = "chosen"
		if participantID == "" {
			res.Match = "new"
			id, err := q.MatchParticipant(ctx, ws, companyID, source.Name, PortalLogin(source))
			if err != nil {
				return err
			}
			if id != "" {
				participantID = id
				res.Match = "email"
				if c, _ := q.Contact(ctx, companyID, id); PortalLogin(source) == "" || c.Email == nil || *c.Email != PortalLogin(source) {
					res.Match = "name"
				}
			}
		}
		if participantID != "" {
			c, err := q.Contact(ctx, companyID, participantID)
			if errors.Is(err, store.ErrNotFound) {
				return validationFailed(map[string]string{"participant_id": "Choose a person of this company."})
			}
			if err != nil {
				return err
			}
			person = &c
		}
		res.ParticipantID = participantID
		if dryRun {
			return nil
		}
		fields := personFields(source, person)
		if person == nil {
			participantID = auth.NewID("con")
			if err := q.CreateContact(ctx, ws, companyID, participantID, fields, false, s.now()); err != nil {
				return err
			}
		} else if err := q.UpdateContact(ctx, companyID, participantID, fields, false, s.now()); err != nil {
			return err
		}
		res.ParticipantID = participantID
		if err := q.MergeClientIntoParticipant(ctx, ws, sourceID, companyID, participantID, sess.User.ID, s.now()); err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]any{"client_id": sourceID, "client_name": source.Name, "company_id": companyID,
			"company_name": company.Name, "participant_id": participantID, "counts": res.Counts})
		if err != nil {
			return err
		}
		return q.LogEvent(ctx, store.FinancialEvent{WorkspaceID: ws, Kind: "client.merged_into_participant", SubjectType: "client",
			SubjectID: companyID, ActorID: &sess.User.ID, At: s.now(), Payload: payload})
	})
	return res, err
}

// personFields: the participant role, plus what the matched person lacks from the person client (all of it for a new
// one): name, email, phone, the private address and VAT number. A person's own company email stays their email.
func personFields(c store.Client, p *store.Contact) map[string]any {
	f := map[string]any{}
	if p == nil {
		p = &store.Contact{}
		f["name"] = c.Name
	}
	roles := []string{store.RoleParticipant}
	if p.Is(store.RoleContact) {
		roles = []string{store.RoleContact, store.RoleParticipant}
	}
	f["roles"] = roles
	set := func(col string, have, from *string) {
		if (have == nil || *have == "") && from != nil && *from != "" {
			f[col] = *from
		}
	}
	login := PortalLogin(c)
	set("email", p.Email, &login)
	set("phone", p.Phone, c.Phone)
	set("vat_number", p.VATNumber, c.VATNumber)
	if p.Street == nil || *p.Street == "" { // the address goes over whole, never mixed with the person's own
		set("street", nil, c.Street)
		set("street_number", nil, c.StreetNumber)
		set("zip", nil, c.Zip)
		set("city", nil, c.City)
		set("country", nil, c.Country)
	}
	if c.PortalEnabled && (p.Email != nil && *p.Email != "" || login != "") {
		f["portal_enabled"] = true
	}
	return f
}
