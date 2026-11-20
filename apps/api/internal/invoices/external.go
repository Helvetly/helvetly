package invoices

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/invoicecalc"
	"helvetly.com/api/internal/invoicepdf"
	"helvetly.com/api/internal/store"
)

// CreateDraft saves a new draft for a client inside the caller's transaction q (no transaction of its own). The
// client's currency, language and terms and the settings' VAT mode are applied before fill, so fill can pick net or
// gross from inv.VATMode; the lines it sets are checked like those of POST /invoices. An unknown client wraps
// store.ErrNotFound.
func (s *Service) CreateDraft(ctx context.Context, q store.Q, sess store.Session, clientID string, fill func(*store.Invoice)) (string, error) {
	c, err := q.Client(ctx, sess.Workspace.ID, clientID)
	if err != nil {
		return "", fmt.Errorf("client %s: %w", clientID, err)
	}
	set, err := loadSettings(ctx, q, sess.Workspace.ID)
	if err != nil {
		return "", err
	}
	inv, _ := newDraft(&c, set, s.today(sess.Workspace))
	inv.PaymentMethods = defaultMethods(set, inv.Currency)
	fill(&inv)
	for i := range inv.Lines {
		l := &inv.Lines[i]
		l.ID, l.Position = auth.NewID("lin"), i+1
		if inv.VATMode == invoicecalc.None {
			l.VATCategory, l.VATRate = "O", 0
		}
		if (l.VATCategory == "S") != (l.VATRate > 0) || !slices.Contains(invoicecalc.Categories, l.VATCategory) {
			return "", validationFailed(map[string]string{fmt.Sprintf("lines.%d.vat_rate", i): "Only standard-rated (S) lines have a VAT rate, and S needs one above 0."})
		}
		if l.Quantity <= 0 || l.Quantity > maxQuantity || l.UnitPrice < 0 || l.UnitPrice > maxPrice {
			return "", validationFailed(map[string]string{fmt.Sprintf("lines.%d", i): "Enter a quantity and unit price within range."})
		}
	}
	if len(inv.Lines) > maxLines {
		return "", validationFailed(map[string]string{"lines": fmt.Sprintf("Use at most %d lines.", maxLines)})
	}
	inv.PaymentMethods = usableMethods(inv.PaymentMethods, set, inv.Currency)
	if t := compute(&inv); t.Payable() > maxPayable {
		return "", validationFailed(map[string]string{"lines": "The total cannot exceed 999'999'999.99."})
	}
	draftPayment(&inv, set)
	if err := q.SaveDraft(ctx, sess.Workspace.ID, inv, s.now()); err != nil {
		return "", err
	}
	return inv.ID, wrote(ctx, q, sess, inv.ID)
}

// Seller returns the invoice settings' seller block, the logo bytes (nil for none) and the settings' language, for
// documents other than invoices (the engagements' service report).
func (s *Service) Seller(ctx context.Context, q store.Q, workspaceID string) (store.Party, []byte, string, error) {
	set, err := loadSettings(ctx, q, workspaceID)
	if err != nil {
		return store.Party{}, nil, "", err
	}
	logo, err := s.logoBytes(ctx, workspaceID, set)
	if err != nil {
		return store.Party{}, nil, "", fmt.Errorf("logo: %w", err)
	}
	return set.Seller.Party, logo, set.Language, nil
}

// QuoteFields are the invoice input fields a quote takes (docs/quotes-contract.md); its valid_until is its own.
var QuoteFields = []string{"client_id", "issue_date", "currency", "language", "vat_mode", "reference", "intro", "footer", "note",
	"discount_percent", "lines"}

// NewQuote: an invoice-shaped quote (kind "quote") for a client of the workspace, with the settings' and the client's
// currency, language, VAT mode, footer and reference. A missing client is a validation error on client_id.
func (s *Service) NewQuote(ctx context.Context, q store.Q, sess store.Session, body map[string]json.RawMessage) (store.Invoice, error) {
	client, err := clientFor(ctx, q, sess.Workspace.ID, body)
	if err != nil {
		return store.Invoice{}, err
	}
	set, err := loadSettings(ctx, q, sess.Workspace.ID)
	if err != nil {
		return store.Invoice{}, err
	}
	inv, _ := newDraft(client, set, s.today(sess.Workspace))
	inv.Kind = "quote"
	return inv, nil
}

// ApplyQuote validates the QuoteFields in body onto the quote, as POST /invoices does, and computes its totals with
// internal/invoicecalc. A field outside QuoteFields is the caller's to refuse.
func (s *Service) ApplyQuote(ctx context.Context, q store.Q, workspaceID string, inv *store.Invoice, body map[string]json.RawMessage) error {
	set, err := loadSettings(ctx, q, workspaceID)
	if err != nil {
		return err
	}
	clientID := inv.ClientID
	if err := applyInput(inv, body, set); err != nil {
		return err
	}
	if inv.ClientID != clientID {
		if _, err := clientFor(ctx, q, workspaceID, body); err != nil {
			return err
		}
	}
	return resolveContractDocument(ctx, q, workspaceID, inv, body)
}

// QuoteNumber: Q-{YYYY}-{NNN}, or the workspace's format when it prints the type, so quotes follow it too. Quotes
// count per year, so a yearless format would repeat their numbers and keeps the default.
func (s *Service) QuoteNumber(ctx context.Context, q store.Q, workspaceID, issueDate string, seq int64) (string, error) {
	set, err := loadSettings(ctx, q, workspaceID)
	if err != nil {
		return "", err
	}
	format := "Q-{YYYY}-{NNN}"
	if strings.Contains(set.NumberFormat, "{TYPE}") && counterYear(set.NumberFormat, issueDate) != 0 {
		format = set.NumberFormat
	}
	return formatNumber(format, "quote", issueDate, seq), nil
}

// QuotePDF renders a quote (kind "quote", valid-until in DueDate) with the current seller settings, logo and client;
// draft watermarks it. A quote has no QR bill.
func (s *Service) QuotePDF(ctx context.Context, q store.Q, workspaceID string, inv store.Invoice, draft bool) ([]byte, error) {
	set, err := loadSettings(ctx, q, workspaceID)
	if err != nil {
		return nil, err
	}
	client, err := q.Client(ctx, workspaceID, inv.ClientID)
	if err != nil {
		return nil, err
	}
	buyer := buyerOf(client)
	inv.Buyer, inv.Payment = &buyer, store.InvoicePaymentInfo{}
	logo, err := s.logoBytes(ctx, workspaceID, set)
	if err != nil {
		return nil, fmt.Errorf("logo: %w", err)
	}
	doc := s.document(inv, set, draft, nil)
	doc.Logo = logo
	return invoicepdf.Render(doc)
}
