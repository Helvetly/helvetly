// Package delivery sends an issued invoice's e-document through a channel (docs/delivery-contract.md): a file the
// user uploads to a portal (export), a government API (national) or a Peppol / access-point provider
// (intermediary). Requests queue a transmission; the job sends it and retries failures. Channels plug in through
// Channel; a workspace's credentials for one are sealed with AES-GCM and never leave the server.
package delivery

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Kind is how a channel reaches the recipient.
type Kind string

const (
	Export       Kind = "export"
	National     Kind = "national"
	Intermediary Kind = "intermediary"
)

// Document is what a channel sends: an issued invoice's archived XML in one format. TransmissionID is the same on
// every attempt of one transmission: a channel passes it as its provider's idempotency key, or looks it up before
// sending again, so a retry after an unknown outcome (a timeout once the provider may have accepted) is no second
// submission.
type Document struct {
	TransmissionID, WorkspaceID, InvoiceID, Format, Filename string
	XML                                                      []byte
}

// Result is a channel's answer: sent (handed over) or accepted with the channel's id (a KSeF number, an SdI file
// name, a Peppol message id), or rejected.
type Result struct {
	Status     string // sent, accepted or rejected
	ExternalID string
	Reason     string // why the channel rejected it, shown as the transmission's last error
}

// Channel is one way out. Storecove, B2Brouter or Recommand (intermediary), KSeF or ANAF (national) implement it.
type Channel interface {
	Name() string
	Kind() Kind
	Formats() []string // the e-invoice formats it takes: xrechnung-ubl, xrechnung-cii, peppol
	NeedsCredentials() bool
	// Send hands doc over; credentials are the workspace's for this channel (nil when it needs none). Wrap an error
	// no retry can fix in Permanent.
	Send(ctx context.Context, doc Document, credentials []byte) (Result, error)
}

// Permanent marks a channel error a retry cannot fix (a validation refusal); the transmission fails at once.
type Permanent struct{ Err error }

func (p Permanent) Error() string { return p.Err.Error() }
func (p Permanent) Unwrap() error { return p.Err }

// Exporter is internal/einvoice's Export: the archived XML of an issued invoice, with errors the API's.
type Exporter func(ctx context.Context, sess store.Session, inv store.Invoice, format string) (name string, xml []byte, err error)

// Auth is what the handlers use of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
	Decode(http.ResponseWriter, *http.Request, any) bool
}

type Service struct {
	db       *store.Store
	auth     Auth
	export   Exporter
	sealer   sealer
	channels []Channel
	log      *slog.Logger
	now      func() time.Time
}

// New wires the channels this server offers; secret is SECRET_KEY, from which the credential key is derived.
func New(db *store.Store, a Auth, export Exporter, secret []byte, log *slog.Logger, channels ...Channel) (*Service, error) {
	s, err := newSealer(secret)
	if err != nil {
		return nil, err
	}
	return &Service{db: db, auth: a, export: export, sealer: s, channels: channels, log: log, now: time.Now}, nil
}

func (s *Service) channel(name string) Channel {
	i := slices.IndexFunc(s.channels, func(c Channel) bool { return c.Name() == name })
	if i < 0 {
		return nil
	}
	return s.channels[i]
}

// FileExport is the export channel: the XML is produced and archived for the user to upload to a portal (the
// ESTV, KSeF's Aplikacja Podatnika, ANAF's SPV, a German OZG-RE); it is "sent" once the file exists.
type FileExport struct{}

func (FileExport) Name() string           { return "export" }
func (FileExport) Kind() Kind             { return Export }
func (FileExport) Formats() []string      { return []string{"xrechnung-ubl", "xrechnung-cii", "peppol"} }
func (FileExport) NeedsCredentials() bool { return false }
func (FileExport) Send(_ context.Context, doc Document, _ []byte) (Result, error) {
	if len(doc.XML) == 0 {
		return Result{}, Permanent{errors.New("no XML to export")}
	}
	return Result{Status: "sent", ExternalID: doc.Filename}, nil
}

var errUnknownChannel = auth.Error(http.StatusUnprocessableEntity, "validation_failed", "Choose a channel this server offers.",
	map[string]any{"fields": map[string]string{"channel": "invalid"}})
