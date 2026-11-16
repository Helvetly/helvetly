package store

import (
	"context"
	"errors"
)

// Features a canonical write, an import, Heidi or a job checks before its effect: offer keys of kind access.
const (
	FeatureHeidi                = "heidi"
	FeatureDocumentTemplates    = "document_templates"
	FeatureSimpleSignatures     = "simple_signatures"
	FeatureVATReturns           = "vat_returns"
	FeatureInvoiceCorrections   = "invoice_corrections"
	FeatureExpenses             = "expenses"
	FeatureLedgerExports        = "ledger_exports"
	FeatureDataExport           = "data_export"
	FeatureAutomations          = "automations"
	FeatureInvoiceReminders     = "invoice_reminders"
	FeatureInvoiceInstalments   = "invoice_instalments"
	FeatureEngagementAutomation = "engagement_automation"
	FeatureClientPortal         = "client_portal"
	FeatureEInvoiceXML          = "einvoice_xml"
)

// ErrFeatureDenied wraps a gate's refusal (the plan lacks the feature, the workspace has none, or its plan cannot be
// read), so a job can pause instead of failing and a public page can answer without naming the plan.
var ErrFeatureDenied = errors.New("feature not in the plan")

// FeatureGate refuses a feature the workspace's plan does not include, reading its plan through q (a transaction
// when the caller is in one, so the canonical write checks again what the request checked first).
type FeatureGate func(ctx context.Context, q Q, workspaceID, feature string) error

// SetFeatureGate is startup wiring, like SetAdmission: call once before requests or jobs start.
func (s *Store) SetFeatureGate(g FeatureGate) { s.Q.features = g }

// RequireFeature refuses a feature the workspace's plan does not include; without a gate (billing off, package
// tests) every feature is allowed.
func (q Q) RequireFeature(ctx context.Context, workspaceID, feature string) error {
	if q.features == nil {
		return nil
	}
	return q.features(ctx, q, workspaceID, feature)
}

// FeatureAllowed reports whether the workspace may use the feature now, for a job that waits while it may not.
func (q Q) FeatureAllowed(ctx context.Context, workspaceID, feature string) (bool, error) {
	err := q.RequireFeature(ctx, workspaceID, feature)
	if errors.Is(err, ErrFeatureDenied) {
		return false, nil
	}
	return err == nil, err
}
