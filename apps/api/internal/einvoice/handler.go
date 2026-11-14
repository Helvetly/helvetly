package einvoice

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/store"
)

// Auth is what the handler uses of internal/auth.
type Auth interface {
	SignedIn(func(http.ResponseWriter, *http.Request, store.Session)) http.HandlerFunc
	WriteError(http.ResponseWriter, *http.Request, error)
}

type Service struct {
	auth    Auth
	load    func(ctx context.Context, sess store.Session, id string) (store.Invoice, error)
	archive func(context.Context, store.Session, store.Invoice, string, func(store.Invoice) ([]byte, error)) (archivedXML, error)
}

func New(db *store.Store, a Auth, files FileStorage) *Service {
	return &Service{auth: a,
		archive: (&xmlArchive{db: db, files: files, now: time.Now, log: slog.Default()}).export,
		load: func(ctx context.Context, sess store.Session, id string) (store.Invoice, error) {
			return db.Invoice(ctx, sess.Workspace.ID, id, sess.Workspace.Today(time.Now()), false)
		},
	}
}

var formats = map[string]func(store.Invoice) ([]byte, error){
	"xrechnung-ubl": func(inv store.Invoice) ([]byte, error) { return UBL(inv, "xrechnung") },
	"xrechnung-cii": CII,
	"peppol": func(inv store.Invoice) ([]byte, error) {
		return UBL(inv, "peppol")
	},
	"ro-cius": func(inv store.Invoice) ([]byte, error) { return UBL(inv, "ro_cius") },
}

// fa3 renders FA(3) with the document a correction refers to: its issue date, and a corrected invoice's difference.
func (s *Service) fa3(ctx context.Context, sess store.Session, inv store.Invoice) (func(store.Invoice) ([]byte, error), error) {
	var orig *store.Invoice
	if inv.CreditedInvoice != nil {
		o, err := s.load(ctx, sess, inv.CreditedInvoice.ID)
		if err != nil {
			return nil, err
		}
		orig = &o
	}
	return func(inv store.Invoice) ([]byte, error) { return FA3(inv, orig, time.Now()) }, nil
}

func (s *Service) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/invoices/{id}/einvoice", s.auth.SignedIn(s.get))
}

// FormatFA3 is the KSeF structured invoice FA(3), uploaded by the seller in KSeF (Aplikacja Podatnika).
const FormatFA3 = "ksef-fa3"

func (s *Service) get(w http.ResponseWriter, r *http.Request, sess store.Session) {
	format := r.URL.Query().Get("format")
	render, ok := formats[format]
	if !ok && format != FormatFA3 {
		s.auth.WriteError(w, r, auth.Error(http.StatusBadRequest, "invalid_request",
			"format must be xrechnung-ubl, xrechnung-cii, peppol, ro-cius or ksef-fa3.", nil))
		return
	}
	inv, err := s.load(r.Context(), sess, r.PathValue("id"))
	if err == nil && format == FormatFA3 {
		render, err = s.fa3(r.Context(), sess, inv)
	}
	if errors.Is(err, store.ErrNotFound) {
		err = auth.ErrNotFound
	}
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	saved, err := s.export(r.Context(), sess, inv, r.URL.Query().Get("format"), render)
	if err != nil {
		s.auth.WriteError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	filename := deref(inv.Number) + ".xml"
	if saved.record.Filename != "" {
		filename = saved.record.Filename
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "private, no-store")
	if saved.record.SHA256 != "" {
		w.Header().Set("X-Helvetly-XML-SHA256", saved.record.SHA256)
		w.Header().Set("X-Helvetly-XML-Version", saved.record.Version)
		w.Header().Set("X-Helvetly-XML-Archived-At", saved.record.CreatedAt.UTC().Format(time.RFC3339Nano))
	}
	// Synthetic profile validation does not establish every recipient's or country's requirements.
	w.Header().Set("X-Helvetly-Preview", "true")
	_, _ = w.Write(saved.bytes)
}

// Export is an issued invoice's XML in format (xrechnung-ubl, xrechnung-cii or peppol), archived on first export
// as the download is, with its file name; errors are the API's. Invoice emails and deliveries attach it.
func (s *Service) Export(ctx context.Context, sess store.Session, inv store.Invoice, format string) (name string, xml []byte, err error) {
	render, ok := formats[format]
	if !ok {
		return "", nil, fmt.Errorf("einvoice: unknown format %q", format)
	}
	saved, err := s.export(ctx, sess, inv, format, render)
	if err != nil {
		return "", nil, err
	}
	name = deref(inv.Number) + ".xml"
	if saved.record.Filename != "" {
		name = saved.record.Filename
	}
	return name, saved.bytes, nil
}

func (s *Service) export(ctx context.Context, sess store.Session, inv store.Invoice, format string,
	render func(store.Invoice) ([]byte, error)) (archivedXML, error) {
	if inv.IssuedElsewhere() { // its XML would be a second original of an invoice another system issued
		return archivedXML{}, errIssuedElsewhere
	}
	var saved archivedXML
	var err error
	if s.archive != nil {
		saved, err = s.archive(ctx, sess, inv, format, render)
	} else {
		saved.bytes, err = render(inv)
	}
	return saved, problem(err)
}

var errIssuedElsewhere = auth.Error(http.StatusConflict, "issued_elsewhere",
	"This invoice was issued in another system: it has no e-invoice XML from Helvetly. Send it from that system.", nil)

// problem turns a serializer or archive error into the API's answer.
func problem(err error) error {
	var ro *ROError
	switch {
	case errors.As(err, &ro):
		err = auth.Error(http.StatusConflict, "einvoice_cius_ro_incomplete",
			"This document cannot be an RO e-Factura yet: "+strings.Join(ro.Reasons, "; ")+".", map[string]any{"reasons": ro.Reasons})
	case errors.Is(err, ErrUnsupported):
		err = auth.Error(http.StatusConflict, "invalid_state", "Only issued invoices and credit notes have e-invoice XML.", nil)
	case errors.Is(err, ErrSellerContact):
		err = auth.Error(http.StatusConflict, "einvoice_seller_contact_missing",
			"XRechnung needs the seller's phone and email recorded when the invoice was issued. Current settings cannot replace missing historical contact details.", nil)
	case errors.Is(err, ErrVATCategories):
		err = auth.Error(http.StatusConflict, "einvoice_vat_categories_incompatible",
			"E-invoice XML cannot combine outside-scope VAT with other VAT categories. Use separate documents for these transactions.", nil)
	case errors.Is(err, ErrOutsideScope):
		err = auth.Error(http.StatusConflict, "einvoice_outside_scope_unsupported",
			"Outside-scope VAT XML needs a seller registration number recorded when the invoice was issued. Current settings cannot replace missing historical identifiers.", nil)
	case errors.Is(err, ErrEndpointMissing):
		err = auth.Error(http.StatusConflict, "einvoice_endpoint_missing",
			"Peppol XML requires explicit, valid seller and buyer electronic endpoint identifiers. Email addresses cannot be used as Peppol participant identifiers.", nil)
	case errors.Is(err, ErrFA3SellerNIP):
		err = auth.Error(http.StatusConflict, "einvoice_seller_nip_missing",
			"KSeF FA(3) needs a Polish seller with a valid NIP recorded when the invoice was issued.", nil)
	case errors.Is(err, ErrFA3Currency):
		err = auth.Error(http.StatusConflict, "einvoice_currency_unsupported",
			"KSeF FA(3) is exported for PLN invoices only: Helvetly does not record the NBP exchange rate that a foreign-currency invoice must show for its VAT.", nil)
	case errors.Is(err, ErrFA3VAT):
		err = auth.Error(http.StatusConflict, "einvoice_vat_unsupported",
			"KSeF FA(3) takes the Polish rates 23, 8 and 5 %, zero-rated, exempt (with its reason), reverse-charge and outside-scope supplies only.", nil)
	case errors.Is(err, ErrFA3Kind):
		err = auth.Error(http.StatusConflict, "einvoice_kind_unsupported",
			"Prepayment invoices and final invoices with deducted prepayments are not exported as KSeF FA(3) yet.", nil)
	case errors.Is(err, store.ErrNotFound):
		err = auth.ErrNotFound
	case errors.Is(err, errXMLArchiveIntegrity):
		err = auth.Error(http.StatusInternalServerError, "einvoice_archive_corrupt", "The archived XML failed its integrity check. Restore the original archived bytes before downloading it again.", nil)
	case errors.Is(err, errXMLArchiveStorage):
		err = auth.Error(http.StatusServiceUnavailable, "einvoice_archive_unavailable", "The archived XML is temporarily unavailable. Try again later; it will not be regenerated or overwritten.", nil)
	}
	return err
}
