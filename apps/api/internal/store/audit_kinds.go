package store

import (
	"fmt"
	"slices"
	"testing"
)

// AuditKinds is every kind the app writes to the audit log. The platform gives each its own sentence
// (`lib/audit-log.ts`, held to this list by a test); LogEvent refuses any other kind under `go test`.
var AuditKinds = []string{
	"invoice.issued", "invoice.import_overwritten", "invoice.xml_archived", "invoice.voided", "invoice.replaced",
	"payment.added", "payment.deleted", "refund.added", "refund.deleted", "credit.issued",
	"plan.created", "plan.cancelled",
	"expense.booked", "expense.voided", "expense.payment_changed",
	"period.closed", "period.reopened",
	"approval.submitted", "approval.approved", "approval.rejected", "approval.withdrawn", "approval.reset",
	"approvals.group_saved", "approvals.group_deleted", "approvals.policy_saved",
	"workspace.portal_turned_off", "workspace.portal_turned_on", "workspace.portal_address_changed",
	"workspace.portal_domain_added", "workspace.portal_domain_removed", "workspace.reply_to_changed",
	"portal.preview_started", "portal.preview_ended",
	"documents.exported", "documents.folder_repaired", "imports.expired", "email_template.ai_written",
	"quote.contract_drafted", "quote.contract_written", "contract.signature_applied",
	"employee.created", "employee.archived", "employee.unarchived", "employee.deleted", "employee.erased",
	"employee.legal_hold_set", "employee.legal_hold_lifted", "employee.restricted", "employee.unrestricted",
	"employee.protected_viewed", "employee.document_added", "employee.document_deleted",
	"employee.document_hold_set", "employee.document_hold_lifted", "employee.pay_terms_added",
	"employee.pay_terms_removed",
	"payroll.booked", "payroll.exported", "payroll.corrected", "payroll.approved", "payroll.paid", "payroll.unpaid",
	"payroll.four_eyes_on", "payroll.four_eyes_off",
	"scheduling.cancelled", "scheduling.attendance_changed", "scheduling.waived", "scheduling.moved_from_calendar",
	"scheduling.request_decided", "scheduling.booking_link_created", "scheduling.booking_link_revoked",
	"scheduling.booking_link_used", "scheduling.settings_changed", "scheduling.holidays_changed",
	"scheduling.event_type_changed", "scheduling.calendar_connected", "scheduling.calendar_disconnected",
	"scheduling.feed_rotated",
}

// checkAuditKind fails a test that writes a kind missing from AuditKinds; production never refuses an entry.
func checkAuditKind(kind string) error {
	if testing.Testing() && !slices.Contains(AuditKinds, kind) {
		return fmt.Errorf("audit kind %q is not in store.AuditKinds: add it there and give it a sentence in the platform", kind)
	}
	return nil
}
