package employees

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	"helvetly.com/api/internal/store"
)

// Export writes the workspace's HR data into its owner's workspace export (internal/dataexport, owner-only), with the
// sealed fields opened: when the plan has the module, or after a downgrade while HR data is kept. Heidi, MCP and API
// tokens never reach it.
func (s *Service) Export(ctx context.Context, workspaceID string, w store.ExportWriter) ([]store.ExportFile, bool, error) {
	allowed, err := s.db.FeatureAllowed(ctx, workspaceID, store.FeatureEmployees)
	if err != nil {
		return nil, false, err
	}
	kept, err := s.db.HasHRData(ctx, workspaceID)
	if err != nil || !allowed && !kept {
		return nil, false, err
	}
	files, err := s.db.ExportHR(ctx, workspaceID, &unsealing{ExportWriter: w, s: s, workspaceID: workspaceID})
	return files, err == nil, err
}

// sealedColumns are the employees' sealed columns and the field each was sealed as.
var sealedColumns = map[string]string{"bank_account_sealed": "bank_account", "tax_id_sealed": "tax_id",
	"social_security_number_sealed": "social_security_number"}

// unsealing writes the employees table with each sealed column replaced by its opened value.
type unsealing struct {
	store.ExportWriter
	s           *Service
	workspaceID string
	table       string
}

func (u *unsealing) Table(name string) error {
	u.table = name
	return u.ExportWriter.Table(name)
}

func (u *unsealing) Row(v json.RawMessage) error {
	if u.table != "employees" {
		return u.ExportWriter.Row(v)
	}
	var row map[string]any
	if err := json.Unmarshal(v, &row); err != nil {
		return err
	}
	id, _ := row["id"].(string)
	for column, field := range sealedColumns {
		sealed, _ := row[column].(string)
		delete(row, column)
		row[field] = nil
		if sealed == "" {
			continue
		}
		b, err := hex.DecodeString(strings.TrimPrefix(sealed, `\x`))
		if err != nil {
			return fmt.Errorf("employee %s %s: %w", id, field, err)
		}
		plain, err := u.s.seal.open(u.workspaceID, id, field, b)
		if err != nil {
			return fmt.Errorf("employee %s %s: %w", id, field, err)
		}
		row[field] = plain
	}
	out, err := json.Marshal(row)
	if err != nil {
		return err
	}
	return u.ExportWriter.Row(out)
}
