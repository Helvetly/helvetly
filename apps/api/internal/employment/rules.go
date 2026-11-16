// Package employment is the jurisdiction data behind the employees module (docs/planning/2026-11-15-employees.md):
// the modelled countries and regions, the rules as data with their sources, check dates, validity and verification
// status, and the resolution of what an employee's situation supports. It calculates no pay and decides no
// obligation; a situation it cannot place is reported, never guessed.
package employment

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
)

// Rule is one rule version from the jurisdiction research, valid between two dates ("" = open). Status is how far its
// source was checked: verified (the official source was read and matches), partially_verified, not_verified. No rule
// here is a legal review, and none drives a calculation: the module records, it does not compute pay.
type Rule struct {
	ID             string   `json:"id"`
	Jurisdiction   string   `json:"jurisdiction"` // "CH", "DE", "US", "US-CA"
	Topic          string   `json:"topic"`        // "retention" or the research topic
	DocumentType   string   `json:"document_type,omitempty"`
	Scope          string   `json:"scope"`
	Summary        string   `json:"summary,omitempty"`
	Years          int      `json:"years,omitempty"`
	Trigger        string   `json:"trigger,omitempty"`
	TriggerText    string   `json:"trigger_text,omitempty"`
	Guidance       string   `json:"guidance,omitempty"`
	MaxGuidance    string   `json:"max_guidance,omitempty"`
	Source         string   `json:"source,omitempty"`
	SourceURL      string   `json:"source_url"`
	CheckedAt      string   `json:"checked_at"`
	ValidFrom      string   `json:"valid_from"`
	ValidTo        string   `json:"valid_to"`
	RequiredData   []string `json:"required_data"`
	Implementation string   `json:"implementation"`
	Verification   string   `json:"verification"`
	Limitations    string   `json:"limitations"`
	Status         string   `json:"status"`
}

// Rule statuses, as the research recorded them.
const (
	Verified          = "verified"
	PartiallyVerified = "partially_verified"
	NotVerified       = "not_verified"
)

// Retention triggers that can be dated from what the module knows; any other trigger (a tax year, a later of two
// dates, a payment) leaves the rule as guidance for a person to apply.
const (
	FromEmploymentEnd = "end_of_employment"
	FromRecord        = "record_creation"
	FromLastEntry     = "last_entry"
	FromPayment       = "date_of_payment"
	FromYearEnd       = "end_of_calendar_year"
	FromBusinessYear  = "end_of_business_year" // taken as the calendar year: the workspace has no other business year
)

// Jurisdiction is a researched jurisdiction and how far it was researched.
type Jurisdiction struct {
	Code           string `json:"code"`
	Name           string `json:"name"`
	Class          string `json:"class"`
	ResearchStatus string `json:"research_status"`
}

// Coverage is what the research found for one jurisdiction and feature, and whether V1 offers it.
type Coverage struct {
	Jurisdiction string `json:"jurisdiction"`
	Feature      string `json:"feature"`
	Status       string `json:"status"`
	OfferedInV1  bool   `json:"offered_in_v1"`
	Limitations  string `json:"limitations"`
}

// Research is the embedded research data: its source and date, and what it covers.
type Research struct {
	Source        string         `json:"source"`
	GeneratedOn   string         `json:"generated_on"`
	Disclaimer    string         `json:"disclaimer"`
	Jurisdictions []Jurisdiction `json:"jurisdictions"`
	Coverage      []Coverage     `json:"coverage"`
	Rules         []Rule         `json:"rules"`
}

//go:embed rules.json
var rulesJSON []byte

var research = mustResearch(rulesJSON)

var rules = research.Rules

func mustResearch(b []byte) Research {
	var r Research
	if err := json.Unmarshal(b, &r); err != nil {
		panic(fmt.Sprintf("employment: rules.json: %v", err))
	}
	return r
}

// Rules lists every rule version.
func Rules() []Rule { return rules }

// Data is the research as a whole, for the jurisdiction view.
func Data() Research { return research }

func country(jurisdiction string) string { c, _, _ := strings.Cut(jurisdiction, "-"); return c }

// valid reports whether the rule version applies on day (YYYY-MM-DD); an empty bound is open.
func (r Rule) valid(day string) bool {
	return (r.ValidFrom == "" || r.ValidFrom <= day) && (r.ValidTo == "" || day <= r.ValidTo)
}

// RuleAt is the version of a topic's rule (for a document type, when given) valid on day for the jurisdiction: a
// region's own rule before its country's, the latest valid_from among overlapping versions.
func RuleAt(jurisdiction, topic, documentType string, day time.Time) (Rule, bool) {
	d := day.Format(time.DateOnly)
	for _, j := range slices.Compact([]string{jurisdiction, country(jurisdiction)}) {
		var best *Rule
		for i, r := range rules {
			if r.Jurisdiction == j && r.Topic == topic && r.DocumentType == documentType && r.valid(d) &&
				(best == nil || r.ValidFrom > best.ValidFrom) {
				best = &rules[i]
			}
		}
		if best != nil {
			return *best, true
		}
	}
	return Rule{}, false
}

// Retention is a document's retention: until the latest date any verified, datable rule of the applicable
// jurisdictions sets (the longest minimum wins), the rules behind it, and the rules a person should read (partially
// verified ones, or verified ones whose start the module cannot date). Not verified rules are ignored.
type Retention struct {
	Until    *time.Time
	Rules    []Rule
	Guidance []Rule
}

// RetainUntil applies the retention rules of the jurisdictions (the employer's country, the place of work and its
// country) to a document type. Each rule's version is the one valid on the document's date, else the end of
// employment, else today.
func RetainUntil(jurisdictions []string, documentType string, documentDate, employmentEnd *time.Time, today time.Time) Retention {
	var out Retention
	at := today
	if documentDate != nil {
		at = *documentDate
	} else if employmentEnd != nil {
		at = *employmentEnd
	}
	day := at.Format(time.DateOnly)
	seen := map[string]bool{}
	for _, j := range jurisdictions {
		if j == "" || seen[j] {
			continue
		}
		seen[j] = true
		for _, r := range rules {
			if r.Topic != "retention" || r.Jurisdiction != j || r.DocumentType != documentType || !r.valid(day) ||
				r.Status == NotVerified {
				continue
			}
			from := start(r.Trigger, documentDate, employmentEnd)
			if r.Status != Verified || r.Years <= 0 || from == nil {
				if r.Status != Verified || r.Years <= 0 || !datable(r.Trigger) {
					out.Guidance = append(out.Guidance, r)
				}
				continue
			}
			until := from.AddDate(r.Years, 0, 0)
			if out.Until == nil || until.After(*out.Until) {
				out.Until = &until
			}
			out.Rules = append(out.Rules, r)
		}
	}
	return out
}

func datable(trigger string) bool {
	switch trigger {
	case FromEmploymentEnd, FromRecord, FromLastEntry, FromPayment, FromYearEnd, FromBusinessYear:
		return true
	}
	return false
}

// start is the date a retention period counts from, or nil when it is not known yet (employment not ended, no date).
func start(trigger string, documentDate, employmentEnd *time.Time) *time.Time {
	switch trigger {
	case FromEmploymentEnd:
		return employmentEnd
	case FromRecord, FromLastEntry, FromPayment:
		return documentDate
	case FromYearEnd, FromBusinessYear:
		if documentDate != nil {
			end := time.Date(documentDate.Year(), 12, 31, 0, 0, 0, 0, time.UTC)
			return &end
		}
	}
	return nil
}
