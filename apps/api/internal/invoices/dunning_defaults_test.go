package invoices

import (
	"slices"
	"testing"

	"helvetly.com/api/internal/dunningcalc"
)

func TestDefaultDunningSettings(t *testing.T) {
	settings := defaultDunningSettings()
	if settings.Enabled || settings.InterestEnabled {
		t.Fatal("automatic reminders and interest must start off")
	}
	if offsets := dunningcalc.Offsets(settings.CalcSteps()); !slices.Equal(offsets, []int{10, 20, 30}) {
		t.Fatalf("default reminder offsets = %v", offsets)
	}
	for i, want := range []string{"Payment reminder", "Second reminder", "Final reminder"} {
		step := settings.Steps[i]
		if step.Name != nil || step.Fee != 0 || !step.QRBill {
			t.Errorf("step %d = %+v", i+1, step)
		}
		if _, title := settings.Words("en", i+1, false); title != want {
			t.Errorf("step %d title = %q, want %q", i+1, title, want)
		}
	}
}
