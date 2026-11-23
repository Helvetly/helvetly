package documents

import (
	"context"
	"net/http"
	"strings"

	"helvetly.com/api/internal/store"
)

// Folder language: plain folders AI filing and organizing make are named in the language of whoever asked (the
// uploader for filing), never the document's. The model is told the language; a common folder kind it names in
// another language is put into that language here, and an existing folder of the same kind in any language is used
// instead of a new sibling. People's own folders are never renamed.

// folderKinds: common plain folders by meaning. Per language, the first name is the one made; the others are
// recognised too.
var folderKinds = map[string]map[string][]string{
	"contracts": {"en": {"Contracts", "Contract", "Agreements"}, "de": {"Verträge", "Vertrag", "Vereinbarungen"},
		"fr": {"Contrats", "Contrat"}, "it": {"Contratti", "Contratto"}},
	"company": {"en": {"Company Documents", "Company Records", "Corporate Documents", "Business Documents"},
		"de": {"Unternehmensdokumente", "Firmendokumente", "Geschäftsdokumente", "Gesellschaftsdokumente"},
		"fr": {"Documents d'entreprise", "Documents de l'entreprise", "Documents de société"},
		"it": {"Documenti aziendali", "Documenti societari"}},
	"insurance": {"en": {"Insurance", "Insurances"}, "de": {"Versicherungen", "Versicherung"},
		"fr": {"Assurances", "Assurance"}, "it": {"Assicurazioni", "Assicurazione"}},
	"invoices": {"en": {"Invoices", "Invoice"}, "de": {"Rechnungen", "Rechnung"}, "fr": {"Factures", "Facture"},
		"it": {"Fatture", "Fattura"}},
	"receipts": {"en": {"Receipts", "Receipt"}, "de": {"Quittungen", "Belege", "Quittung", "Beleg"},
		"fr": {"Reçus", "Quittances", "Reçu"}, "it": {"Ricevute", "Ricevuta"}},
	"bank": {"en": {"Bank Statements", "Bank"}, "de": {"Kontoauszüge", "Bank", "Bankauszüge"},
		"fr": {"Relevés bancaires", "Banque", "Relevés de compte"}, "it": {"Estratti conto", "Banca"}},
	"taxes": {"en": {"Taxes", "Tax"}, "de": {"Steuern", "Steuer"}, "fr": {"Impôts", "Impôt", "Fiscalité"},
		"it": {"Tasse", "Imposte", "Fisco"}},
	"payroll": {"en": {"Payroll", "Payslips"}, "de": {"Lohnabrechnungen", "Lohn", "Löhne"},
		"fr": {"Salaires", "Fiches de salaire"}, "it": {"Stipendi", "Buste paga"}},
	"quotes": {"en": {"Quotes", "Quote", "Offers"}, "de": {"Offerten", "Angebote", "Offerte", "Angebot"},
		"fr": {"Devis"}, "it": {"Preventivi", "Preventivo", "Offerte"}},
	"correspondence": {"en": {"Correspondence", "Letters"}, "de": {"Korrespondenz", "Briefe"},
		"fr": {"Correspondance", "Courrier"}, "it": {"Corrispondenza", "Lettere"}},
	"certificates": {"en": {"Certificates"}, "de": {"Zertifikate", "Bescheinigungen", "Zeugnisse"},
		"fr": {"Certificats", "Attestations"}, "it": {"Certificati", "Attestati"}},
	"legal": {"en": {"Legal"}, "de": {"Rechtliches", "Recht"}, "fr": {"Juridique"}, "it": {"Legale", "Documenti legali"}},
	"leases": {"en": {"Leases", "Rental Agreements"}, "de": {"Mietverträge", "Miete"}, "fr": {"Baux", "Bail", "Location"},
		"it": {"Contratti di locazione", "Affitto"}},
	"marketing":     {"en": {"Marketing"}, "de": {"Marketing", "Werbung"}, "fr": {"Marketing"}, "it": {"Marketing"}},
	"presentations": {"en": {"Presentations"}, "de": {"Präsentationen"}, "fr": {"Présentations"}, "it": {"Presentazioni"}},
}

// languageNames: how the model is told the folder language.
var languageNames = map[string]string{"en": "English", "de": "German", "fr": "French", "it": "Italian"}

// kindByName: folderKinds read the other way, by key.
var kindByName = func() map[string]string {
	out := map[string]string{}
	for kind, langs := range folderKinds {
		for _, names := range langs {
			for _, n := range names {
				out[nameKey(n)] = kind
			}
		}
	}
	return out
}()

func nameKey(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.ReplaceAll(name, "’", "'")), " "))
}

// folderKind: the common kind a folder name is in any language, "" for none.
func folderKind(name string) string { return kindByName[nameKey(name)] }

// localName: a new folder's name in lang when it is a common kind, else as given.
func localName(name, lang string) string {
	if kind := folderKind(name); kind != "" {
		return folderKinds[kind][lang][0]
	}
	return name
}

// sameFolder: the name of a sibling that is name (any case) or of its kind (any language), "" for none; an exact
// name wins over a kind.
func sameFolder(name string, siblings []string) string {
	kind, match := folderKind(name), ""
	for _, s := range siblings {
		if strings.EqualFold(s, name) {
			return s
		}
		if match == "" && kind != "" && folderKind(s) == kind {
			match = s
		}
	}
	return match
}

// localPath: a proposed plain path with each level that names an existing folder by name or kind kept as that
// folder, and each new level of a common kind named in lang.
func localPath(path []string, folders []store.Folder, lang string) []string {
	out := make([]string, 0, len(path))
	var parent *string
	for i, name := range path {
		var siblings []string
		ids := map[string]string{}
		for _, f := range folders {
			if f.SystemKind == nil && samePlace(f.ParentID, parent) {
				siblings = append(siblings, f.Name)
				ids[f.Name] = f.ID
			}
		}
		if have := sameFolder(name, siblings); have != "" {
			out = append(out, have)
			id := ids[have]
			parent = &id
			continue
		}
		for _, rest := range path[i:] { // below a new folder everything is new
			out = append(out, localName(rest, lang))
		}
		break
	}
	return out
}

// requestLanguage: the asker's language among en, de, fr and it (?lang, else Accept-Language), "" for none.
func requestLanguage(r *http.Request) string {
	tags := []string{r.URL.Query().Get("lang")}
	for _, part := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		tags = append(tags, strings.TrimSpace(strings.SplitN(part, ";", 2)[0]))
	}
	for _, tag := range tags {
		if lang := strings.ToLower(strings.SplitN(tag, "-", 2)[0]); languageNames[lang] != "" {
			return lang
		}
	}
	return ""
}

// folderLanguage: the language new folders get: lang when supported, else the workspace's document language (its
// invoice settings, when saved), else English.
func (s *Service) folderLanguage(ctx context.Context, workspaceID, lang string) (string, error) {
	if languageNames[lang] != "" {
		return lang, nil
	}
	var set struct {
		Language string `json:"language"`
	}
	if _, err := s.db.InvoiceSettings(ctx, workspaceID, &set); err != nil {
		return "", err
	}
	if languageNames[set.Language] != "" {
		return set.Language, nil
	}
	return "en", nil
}

// folderLanguageRule: what the model is told about the language of new folder names.
func folderLanguageRule(lang string) string {
	return "Name every new folder in " + languageNames[lang] + ", whatever the document's language.\n"
}

// isContract: a plain path or the first (kind) tag says contract, in any of the languages.
func isContract(path, tagList []string) bool {
	for _, seg := range path {
		if folderKind(seg) == "contracts" {
			return true
		}
	}
	return len(tagList) > 0 && folderKind(tagList[0]) == "contracts"
}
