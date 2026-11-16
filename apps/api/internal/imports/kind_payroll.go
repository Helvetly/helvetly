package imports

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"slices"
	"strings"

	"helvetly.com/api/internal/employees"
	"helvetly.com/api/internal/store"
)

func init() { register(payrollKind) }

// payrollKind imports payroll register entries from a CSV that a person or a payroll system produced. It is read
// here, never by the AI model, and its file stays an HR file (Private): payroll data leaves Helvetly for no model.
var payrollKind = Kind{
	Name:       "payroll",
	Label:      "Payroll",
	Resource:   "payroll",
	Feature:    store.FeatureEmployees,
	LabelField: "employee_number",
	Private:    true,
	Schema: record(func() map[string]any {
		props := map[string]any{}
		for _, f := range employees.ImportFields {
			props[f] = nullable("string", f)
		}
		return props
	}()),
	Parse: parsePayroll,
	Check: func(ctx context.Context, q store.Q, workspaceID string, data Data) (map[string]string, error) {
		return employees.CheckImport(ctx, q, workspaceID, data)
	},
	Duplicate: func(context.Context, store.Q, string, Data) (*store.ImportDuplicate, error) { return nil, nil },
	Conflict: func(ctx context.Context, q store.Q, workspaceID string, data Data) (*store.ImportConflict, error) {
		return employees.ImportConflict(ctx, q, workspaceID, data)
	},
	Create: func(ctx context.Context, q store.Q, sess store.Session, data Data, _ Source) (string, error) {
		return employees.CreateImport(ctx, q, sess, data)
	},
	Overwrite: func(ctx context.Context, q store.Q, sess store.Session, data Data, _ Source, id string) (string, error) {
		return employees.OverwriteImport(ctx, q, sess, data, id)
	},
}

var decimalComma = regexp.MustCompile(`^-?\d+,\d{1,2}$`)

// payrollAliases are column names Swiss payroll programs export in German or French, read as the import's own. An
// import convenience only: no swissdec certification, no ELM transmission.
var payrollAliases = map[string]string{
	"personalnummer": "employee_number", "mitarbeiternummer": "employee_number", "numéro_personnel": "employee_number",
	"e-mail": "email", "lohnperiode_von": "period_start", "lohnperiode_bis": "period_end", "période_du": "period_start",
	"période_au": "period_end", "währung": "currency", "monnaie": "currency", "bruttolohn": "gross", "salaire_brut": "gross",
	"abzüge": "deductions", "déductions": "deductions", "nettolohn": "net", "salaire_net": "net",
	"arbeitgeberbeiträge": "employer_costs", "cotisations_employeur": "employer_costs", "auszahlungsdatum": "pay_date",
	"date_de_paiement": "pay_date", "bemerkung": "note", "remarque": "note",
}

// parsePayroll reads a CSV with a header row (comma or semicolon separated). Unknown columns are named in the error,
// so a misspelt "gross" never turns into a silently missing value. Empty cells stay out of the record: missing.
func parsePayroll(name, contentType string, data []byte) ([]Data, error) {
	if !strings.HasSuffix(strings.ToLower(name), ".csv") && contentType != "text/csv" {
		return nil, errors.New("Upload the payroll as a CSV file with a header row.")
	}
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	head, _, _ := bytes.Cut(data, []byte("\n"))
	r := csv.NewReader(bytes.NewReader(data))
	if bytes.Count(head, []byte(";")) > bytes.Count(head, []byte(",")) {
		r.Comma = ';'
	}
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		return nil, errors.New("The file has no header row.")
	}
	for i, h := range header {
		header[i] = strings.ReplaceAll(strings.ToLower(strings.TrimSpace(h)), " ", "_")
		if own, ok := payrollAliases[header[i]]; ok {
			header[i] = own
		}
	}
	var unknown []string
	for _, h := range header {
		if h != "" && !slices.Contains(employees.ImportFields, h) {
			unknown = append(unknown, h)
		}
	}
	if len(unknown) > 0 {
		return nil, fmt.Errorf("Unknown columns: %s. Use %s.", strings.Join(unknown, ", "), strings.Join(employees.ImportFields, ", "))
	}
	for _, need := range []string{"period_start", "period_end", "currency"} {
		if !slices.Contains(header, need) {
			return nil, fmt.Errorf("The column %s is missing.", need)
		}
	}
	if !slices.Contains(header, "employee_number") && !slices.Contains(header, "email") {
		return nil, errors.New("Add an employee_number or email column to name the employee.")
	}
	var out []Data
	for line := 2; ; line++ {
		row, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("Line %d cannot be read as CSV.", line)
		}
		d := Data{}
		for i, v := range row {
			v = strings.TrimSpace(v)
			if i >= len(header) || header[i] == "" || v == "" {
				continue
			}
			if r.Comma == ';' && decimalComma.MatchString(v) {
				v = strings.Replace(v, ",", ".", 1)
			}
			d[header[i]], _ = json.Marshal(v)
		}
		if len(d) > 0 {
			out = append(out, d)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("The file has no payroll rows.")
	}
	return out, nil
}
