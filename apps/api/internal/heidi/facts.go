package heidi

import (
	"bytes"
	"encoding/json"
	"slices"
	"strings"

	"helvetly.com/api/internal/auth"
	"helvetly.com/api/internal/permissions"
	"helvetly.com/api/internal/store"
)

// Only business fields that Heidi understands leave the workspace. Unknown and newly added API fields stay local.
var factFields = strings.Fields(`documents_to participant participant_contact_id roles 12m 30d 90d accepted_at accepted_by account account_code accounts active address advance_invoice amount
amount_credited amount_due amount_mode amount_paid amount_refunded applies approval_state approvals apt
archived_at at attention auto_invoice auto_send auto_tags available avg_days_to_pay balance balance_due
balances base basis billing billing_email bookable booked booked_at booked_by booking_date booking_mode
buffer_after buffer_before buyer by by_category cancel_at_period_end cancelled_on carried_in cash_flow
catalogue_currency catalogue_price_basis catalogue_unit_price category category_id category_name city client
client_enabled client_id client_ids client_name client_number_display client_performance
client_performance_on_invoice client_reminders closed_at closed_by closed_months closing closing_balance code
collection_rate color completed_at confirmation confirmed conflicts contact contacts content_type contra
contract_document contract_reference count countries country counts created_at created_by created_folder
credit credit_account credit_total credited_invoice currencies currency currency_code current current_period
current_period_end cutoff_days cutoff_time data date days days_overdue debit debit_account debit_total
decided_at decided_by decision_note deducted_on deductible_amount deductible_percent deductible_vat deleted_at
deleted_by description discount_amount discount_percent document document_date document_id draft drafts
due_date due_on dunning_enabled duplicate_of duration_minutes effective einvoice_format electronic_address
email enabled end end_date ending_soon ends_at ends_on engagement engagement_id entries entry_ids entry_mode
event_id exchange_rate exchange_rate_date exchange_rate_source expected expense_count expenses expenses_count
expires_at feature_available features fee file_count filed_kind files_count first_due_date first_used_at
folder folder_id footer from full_quantity gtin has_more has_pdf historical_estimate holiday host host_id
host_ids host_reminders host_user_id hours id inbox included income incomplete index input_tax input_tax_box
input_vat instalments interest interest_from interest_rate internal_id interval intro invoice invoice_count
invoice_detail invoice_id invoiced invoiced_quantity invoices is_active is_archived is_company is_complete
is_draft is_exception is_overdue is_primary is_you issue_date issue_on issued issued_at item_count items
journal kind label label_de label_en language last_month late lead_days leitweg_id level levels lines
linked_to links location locked_tags max_horizon_days meeting meeting_provider message meta method
min_notice_minutes minutes missing_fields mode month monthly months movements name natural_ends_on net
net_rates net_total next next_cursor note notice_minutes notices notifications number occurrence occurrence_id
offset_days open open_amount open_balances open_count open_instalments opening opening_balance origin
original_start outcome outcome_at outcome_by outstanding overage overage_unit_price overdue overdue_count
overdue_total page page_size paid paid_by_member paid_change paid_count paid_last_month paid_on paid_previous
paid_seats paid_this_month parent_id party path paused payable_total payment payment_method payment_methods
payment_reference payment_status payment_terms_days payments pdf_document pending_change_request pending_count
performed_by period period_id periods phone plan policy_text portal_enabled portal_invited_at
portal_signed_in_at position preferred_name prepaid_total prepayments preset previewable price price_basis
product product_id proposed_times provider purge_at qr_bill quantity quantity_manual quote rate reason
receipt_missing_reason receipts_count receipts_matched record_file recorded records recurrence ref reference
reference_number reference_type refs refund_due refunded_on refunds region registration_number reimburse
reimbursed_on remaining reminders_enabled reply_to_email request results retained_until retains reverse_charge
review revision revolut role rollover rounding_amount rows scheme seats seller send_uncertain_at sent_at
sent_by sent_on sent_to seq sequence service_date service_date_end session shared_at shared_with signed_at
signed_document signers signing_order size sku slot_step_minutes slug source source_document_id source_id
source_invoice_id source_type sources spent spent_this_month staff_proposal starred start start_date starts_at
starts_on state status street street_number subtotal summary supplier_country supplier_name
supplier_vat_number system_kind tags target_id target_type tax tax_currency_rate taxable_amount this_month
time_zone timezone title to to_invoice to_reimburse total total_files total_pages total_size totals tracked
trends trial_end type type_code uid_verified_at unconfirmed_reminders under_pace unearned uninvoiced_quantity
unit unit_minutes unit_price unit_price_gross unit_price_net units unpaid unposted unread updated_at
uploaded_by used user_id valid_until vat vat_amount vat_breakdown vat_category vat_exemption_code
vat_exemption_reason vat_mode vat_number vat_rate vat_to_reclaim vat_total vat_treatment verified_uid
viewed_at views void_reason voided_at voided_by waived warnings year years ziffer zip`)

func workspaceFacts(sess store.Session, operation string, raw json.RawMessage) (json.RawMessage, error) {
	var value any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&value); err != nil {
		return nil, err
	}
	var partial bool
	if envelope, ok := value.(map[string]any); ok {
		if meta, ok := envelope["meta"].(map[string]any); ok {
			for k := range meta {
				if !slices.Contains([]string{"page", "page_size", "total", "total_pages", "has_more", "next_cursor"}, k) {
					delete(meta, k)
				}
			}
			if pages, ok := meta["total_pages"].(json.Number); ok {
				n, _ := pages.Int64()
				partial = n > 1
			}
			if more, ok := meta["has_more"].(bool); ok && more {
				partial = true
			}
			if next, ok := meta["next_cursor"].(string); ok && next != "" {
				partial = true
			}
		}
	}
	allowed := factFields
	// Billing includes HR usage, and signatures include events and signer IPs; only the settings/status a question needs leave these handlers.
	switch operation {
	case "get_invoice_settings":
		allowed = strings.Fields("data seller name street street_number apt zip city country vat_number email phone registration_number legal_form vat_registered default_vat_mode default_vat_rate currency language default_terms_days number_format qr_bill_enabled revolut_enabled instalments dunning payment_confirmation is_complete enabled")
	case "get_vat_settings":
		allowed = strings.Fields("data method period basis net_rates label rate")
	case "get_document_usage":
		allowed = strings.Fields("data files size by_kind kind trash")
	case "get_engagement_settings":
		allowed = strings.Fields("data digest")
	case "list_document_templates", "get_document_template":
		allowed = strings.Fields("data id name description document signers fields label fill kind signer page used_count last_used_at created_at updated_at")
	case "get_quote_contracts":
		allowed = strings.Fields("data document_id number name created_at signature id status")
	case "list_booking_links":
		allowed = strings.Fields("data id host_id event_type_id active expires_at revoked_at created_at last_used_at")
	case "list_approval_inbox":
		allowed = strings.Fields("data id number doc_type doc_id kind client_name issue_date party currency total submitted_at submitted_by name")
	case "list_notifications":
		allowed = strings.Fields("data id event title read_at created_at")
	case "get_workspace_plan":
		allowed = strings.Fields("data enabled plan features status interval paid_seats seats current_period_end cancel_at_period_end trial_end currency")
	case "list_signature_requests":
		allowed = strings.Fields("data id title document name signers status signed_at completed_at expires_at sent_at")
	case "list_workspace_members":
		allowed = strings.Fields("data user_id name role email is_you")
	}
	fields := make(map[string]bool, len(allowed))
	for _, key := range allowed {
		fields[key] = true
	}
	var clean func(any, int) any
	clean = func(v any, depth int) any {
		if depth > 7 {
			partial = true
			return nil
		}
		switch x := v.(type) {
		case map[string]any:
			if source, _ := x["source_type"].(string); strings.HasPrefix(source, "payroll") {
				partial = true
				return nil
			}
			if doc, ok := x["doc_type"].(string); operation == "list_approval_inbox" && ok && !slices.Contains([]string{"invoice", "credit_note", "debit_note", "corrected", "quote", "expense"}, doc) {
				partial = true
				return nil
			}
			if event, ok := x["event"].(string); operation == "list_notifications" && ok {
				kind, _, _ := strings.Cut(event, ".")
				scope := map[string]string{"invoice": "invoices", "dunning": "invoices", "instalment": "invoices", "einvoice": "invoices", "quote": "invoices", "client": "clients", "signature": "documents", "expense": "expenses", "engagement": "engagements", "scheduling": "scheduling", "member": "members", "period": "periods", "vat": "vat-return"}[kind]
				if scope == "" || !permissions.Allows(sess.Role, sess.Scopes, "read:"+scope) {
					partial = true
					return nil
				}
			}
			for k, v := range x {
				if !fields[k] {
					delete(x, k)
					partial = true
					continue
				}
				x[k] = clean(v, depth+1)
			}
		case []any:
			if len(x) > 20 {
				x = x[:20]
				partial = true
			}
			kept := x[:0]
			for _, item := range x {
				if cleaned := clean(item, depth+1); cleaned != nil {
					kept = append(kept, cleaned)
				}
			}
			return kept
		case string:
			if text := []rune(x); len(text) > 500 {
				partial = true
				return string(text[:500]) + "…"
			}
		}
		return v
	}
	result := clean(value, 0)
	facts, err := json.Marshal(map[string]any{"data": result, "partial": partial})
	if err != nil {
		return nil, err
	}
	if len(facts) > 32<<10 {
		return nil, auth.Error(413, "result_too_large", "Narrow your search to fewer records or a shorter date range.", nil)
	}
	return facts, nil
}
