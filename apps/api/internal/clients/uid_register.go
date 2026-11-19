package clients

import (
	"context"
	"time"

	"helvetly.com/api/internal/store"
	"helvetly.com/api/internal/uidregister"
)

// Register finds a company in the Swiss UID register (internal/uidregister).
type Register interface {
	Lookup(ctx context.Context, uid string) (uidregister.Company, bool, error)
}

// SetRegister turns on the UID register check of saved clients.
func (s *Service) SetRegister(r Register) { s.register = r }

// clientUID is the Swiss UID a client gives, from its registration number or else its VAT number; "" for none.
func clientUID(c store.Client) string {
	for _, v := range []*string{c.RegistrationNumber, c.VATNumber} {
		if v != nil {
			if digits := uidregister.ParseUID(*v); digits != "" {
				return uidregister.FormatUID(digits)
			}
		}
	}
	return ""
}

// verifyUID marks a client whose UID the register knows as active, and unmarks one whose UID changed or went.
// It never fails the save: a register that can't be reached leaves the client unmarked until its next save.
func (s *Service) verifyUID(ctx context.Context, workspaceID string, c *store.Client) {
	if s.register == nil {
		return
	}
	uid := clientUID(*c)
	if uid != "" && c.VerifiedUID != nil && *c.VerifiedUID == uid {
		return
	}
	var verified *string
	var at *time.Time
	if uid != "" {
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		company, ok, err := s.register.Lookup(ctx, uid)
		cancel()
		if err != nil {
			s.log.WarnContext(ctx, "uid register check", "client", c.ID, "error", err)
		}
		if ok && company.Active {
			now := s.now()
			verified, at = &uid, &now
		}
	}
	if verified == nil && c.VerifiedUID == nil {
		return
	}
	if err := s.db.SetClientUIDVerification(ctx, workspaceID, c.ID, verified, at); err != nil {
		s.log.ErrorContext(ctx, "record uid register check", "client", c.ID, "error", err)
		return
	}
	c.VerifiedUID, c.UIDVerifiedAt = verified, at
}
