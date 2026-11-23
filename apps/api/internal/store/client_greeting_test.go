package store

import "testing"

func TestGreetingName(t *testing.T) {
	pref := " Beat "
	for _, c := range []struct {
		client Client
		want   string
	}{
		{Client{Name: "Anna Muster"}, "Anna Muster"},
		{Client{Name: "Anna Muster", PreferredName: &pref}, "Beat"},
		{Client{Name: "Muster AG", IsCompany: true}, "Muster AG"},
		{Client{Name: "Muster AG", IsCompany: true, Contacts: []Contact{{Name: "Eva Keller"}, {Name: "Lea Frei", IsPrimary: true}}}, "Lea Frei"},
		{Client{Name: " "}, ""},
	} {
		if got := c.client.GreetingName(); got != c.want {
			t.Errorf("%+v: %q, want %q", c.client, got, c.want)
		}
	}
}
