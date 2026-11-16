---
title: E-Rechnungen für Schweizer Unternehmen mit Kunden im Ausland
description: Warum EU-Kunden Schweizer Lieferanten nach E-Rechnungen fragen und was XRechnung, ZUGFeRD, Peppol, Polens KSeF und Rumäniens e-Factura für Sie bedeuten.
category: E-invoicing
categoryLabel: E-Rechnung
updated: 2026-11-11
readingMinutes: 8
---

In der Schweiz besteht keine allgemeine Verpflichtung zum Versand von E-Rechnungen zwischen Unternehmen. Viele EU-Länder tun dies oder werden es bald tun. Wenn Sie an Kunden in Deutschland, Polen, Rumänien oder anderen EU-Ländern verkaufen, wird früher oder später einer von ihnen schreiben: „Wir können nur Rechnungen im XRechnung-Format akzeptieren“ oder „Bitte senden Sie Ihre Rechnung über Peppol.“

Dieser Leitfaden erklärt, was sich hinter diesen Anfragen verbirgt, welche Regeln tatsächlich für einen Schweizer Verkäufer gelten und was Sie vorbereiten müssen.

## Was gilt als E-Rechnung?

In der EU ist eine E-Rechnung kein per E-Mail versendetes PDF. Es handelt sich um eine **strukturierte Datei** (XML), die die Software des Käufers lesen und buchen kann, ohne dass jemand sie eintippen muss.

Die gemeinsame Grundlage ist die europäische Norm **EN 16931**. Es definiert den Inhalt einer Rechnung (Verkäufer, Käufer, Zeilen, Mehrwertsteueraufschlüsselung, Zahlungsdetails) und ermöglicht zwei XML-Syntaxen: UBL und UN/CEFACT CII. Nationale Formate wie XRechnung, Peppol BIS Billing oder Rumäniens RO_CIUS sind Regelsätze, die auf EN 16931 aufbauen. Polens KSEF verwendet eine eigene nationale Struktur.

## Warum Ihre EU-Kunden nach E-Rechnungen fragen

Die meisten Anfragen gehen auf die eigenen Verpflichtungen des Kunden zurück, nicht auf Ihre:

- **Ihre Kreditorenbuchhaltung wird digitalisiert.** Unternehmen, die E-Rechnungen zu Hause empfangen und versenden müssen, wünschen sich einen einzigen Prozess für alle Lieferanten, auch für ausländische.
- **Öffentliche Stellen verlangen es.** Behörden in der gesamten EU müssen E-Rechnungen akzeptieren, die EN 16931 entsprechen, und viele, darunter auch deutsche Bundesbehörden, akzeptieren nichts anderes.
- **Grenzüberschreitende Berichterstattung kommt.** Im Rahmen des EU-Pakets „Mehrwertsteuer im digitalen Zeitalter“ (ViDA) gilt ab dem 1. Juli 2030 die digitale Berichterstattung auf Basis elektronischer Rechnungen für B2B-Transaktionen innerhalb der EU.

Auch wenn Sie gesetzlich nicht dazu verpflichtet sind, bleiben Sie durch die Möglichkeit, eine gültige E-Rechnung zu senden, auf der Liste der zugelassenen Lieferanten und erhalten schnellere Zahlungen.

## Deutschland: der B2B-Zeitstrahl

Deutschland hat die obligatorische elektronische Rechnungsstellung für inländische B2B-Transaktionen schrittweise eingeführt:

| Datum                 | Was ändert sich                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Januar 2025        | Jedes in Deutschland ansässige Unternehmen muss E-Rechnungen **empfangen** können                                                                           |
| Bis 31. Dezember 2026 | Absender können mit Zustimmung des Käufers weiterhin Papier oder andere elektronische Formate verwenden                                                     |
| 1. Januar 2027        | Unternehmen mit einem Vorjahresgesamtumsatz von über 800’000 Euro müssen E-Rechnungen **versenden**; Kleinere könnten im Jahr 2027 den alten Weg fortsetzen |
| 1. Januar 2028        | Alle in Deutschland ansässigen Unternehmen müssen E-Rechnungen versenden (mit gesetzlichen Ausnahmen, z. B. Kleinunternehmen nach §19 UStG)                 |

Die Pflicht erstreckt sich auf Lieferungen **zwischen Unternehmen, die beide ihren Sitz im Inland haben** (Sitz, Geschäftsleitung oder feste Niederlassung). Ein Schweizer Unternehmen ohne Niederlassung in Deutschland ist in der Regel ausserhalb Deutschlands, auch wenn es über eine deutsche Umsatzsteuer-Identifikationsnummer verfügt. Ihren deutschen Kunden steht es weiterhin frei, elektronische Rechnungen als Geschäftsvoraussetzung zu verlangen, und viele tun dies auch.

Für deutsche Kunden aus dem **öffentlichen Sektor** ist das anders: Seit November 2020 verlangen Bundesbehörden E-Rechnungen, Länder und Kommunen haben ihre eigenen Regeln. Diese Rechnungen benötigen die **Leitweg-ID** des Käufers.

## XRechnung vs ZUGFeRD

Beide werden in Deutschland als E-Rechnungen akzeptiert, sofern sie der EN 16931 entsprechen.

|                                   | XRechnung                                                | ZUGFeRD                                                          |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Was es ist                        | Reine XML-Datei, Deutscher Regelsatz (CIUS) der EN 16931 | Hybrid: ein PDF/A-3 mit darin eingebettetem XML                  |
| Syntax                            | UBL oder CII                                             | CII                                                              |
| Für Menschen lesbar               | Nur mit Zuschauer                                        | Ja, es ist auch ein normales PDF                                 |
| Typische Verwendung               | Öffentlicher Sektor, grössere Unternehmen                | Privates B2B, kleinere Unternehmen                               |
| Gültige E-Rechnung in Deutschland | Ja                                                       | Nur ab Profil EN 16931 aufwärts; MINIMUM und BASIC WL sind nicht |

ZUGFeRD ist technisch identisch mit Frankreichs Factur-X. Wenn ein deutscher Kunde nur „E-Rechnung“ sagt, fragen Sie, welches Format sein System liest. Im Zweifelsfall ist XRechnung die sicherste Antwort.

## Peppol BIS-Abrechnung

**Peppol** ist ein internationales Netzwerk zum Austausch von Geschäftsdokumenten, das von OpenPeppol verwaltet wird. Anstelle von E-Mails werden Rechnungen zwischen zertifizierten **Zugangspunkten** übertragen: Sie senden sie an Ihren Zugangspunkt, der sie an den Zugangspunkt des Käufers liefert, der die Rechnung an den Käufer weiterleitet. Jeder Teilnehmer wird anhand einer **Peppol-Teilnehmer-ID** gefunden, häufig basierend auf einer Umsatzsteuer- oder Firmennummer.

**Peppol BIS Billing 3.0** ist das im Netzwerk verwendete Rechnungsformat. Es ist UBL und entspricht der EN 16931. Viele europäische öffentliche Einrichtungen und Unternehmen erhalten Rechnungen nur über Peppol, auch die deutsche XRechnung kann darüber zugestellt werden.

Um über Peppol zu senden, benötigen Sie einen Access Point-Anbieter. Das Erstellen einer gültigen Peppol BIS-Datei ist die erste Hälfte; Die Bereitstellung über das Netzwerk ist die zweite Möglichkeit.

## Polen: KSEF

Polens Nationales E-Rechnungs-System (**KSeF**, Krajowy System e-Faktur) ist eine zentrale Regierungsplattform. Rechnungen werden in der nationalen XML-Struktur **FA(3)** an KSeF gesendet, KSeF weist jeder Rechnung eine Nummer zu und der Käufer lädt sie von dort herunter.

| Datum                 | Was ändert sich                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. Februar 2026       | Alle Steuerzahler erhalten Rechnungen über KSEF; Auch die grössten Unternehmen (Umsatz 2024 über 200 Mio. PLN) geben sie dort aus |
| 1. April 2026         | Alle anderen Steuerzahler müssen Rechnungen in KSeF                                                                               | ausstellen |
| Bis 31. Dezember 2026 | Unternehmen mit in Rechnung gestellten Umsätzen bis zu 10’000 PLN pro Monat können weiterhin ausserhalb von KSeF                  | ausstellen |

Die Pflicht gilt für Steuerzahler mit **Sitz oder fester Niederlassung in Polen**. Gemäss den offiziellen KSeF-FAQ ist ein ausländischer Verkäufer ohne beides nicht verpflichtet, Rechnungen in KSeF auszustellen, und kann Rechnungen auch ausserhalb von KSeF ausstellen; Eine freiwillige Nutzung von KSEF ist möglich. Polnische Kunden bevorzugen möglicherweise immer noch die KSEF-Struktur, weil sie zu ihrer Buchhaltung passt.

## Rumänien: RO e-Factura

Rumänien betreibt ein zentrales elektronisches Rechnungssystem, **RO e-Factura**, das von der Steuerverwaltung (ANAF) betrieben wird und auf das über deren Online-Portal (SPV) oder API zugegriffen werden kann. Rechnungen folgen **RO_CIUS**, dem rumänischen Regelwerk der EN 16931, in UBL oder CII. Seit 2024 müssen Rechnungen zwischen in Rumänien ansässigen Unternehmen das System durchlaufen, um gültig zu sein.

Wie in Polen konzentrieren sich die Regeln auf im Land ansässige Unternehmen. Wenn Sie in Rumänien für die Mehrwertsteuer registriert sind, ohne dort ansässig zu sein, fragen Sie einen rumänischen Berater, ob und wie das System für Sie gilt. Ihr rumänischer Kunde benötigt in jedem Fall Ihre Rechnungsdaten in einer für ihn speicherbaren Form.

## Was ein Schweizer Verkäufer braucht

Unabhängig vom Format entscheiden dieselben Daten darüber, ob eine E-Rechnung akzeptiert wird. Sammeln Sie es, wenn Sie den Kunden einrichten, nicht, wenn die erste Rechnung zurückgesendet wird.

| Daten                                                                          | Woher kommt es                                                                                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Ihre Schweizer Umsatzsteuer-Identifikationsnummer (CHE-…MWST) und Firmendaten  | Ihre eigenen Aufzeichnungen                                                                        |
| Die Umsatzsteuer-Identifikationsnummer des Käufers (z. B. DE…, PL NIP, RO CUI) | Der Kunde                                                                                          |
| Referenz- oder Bestellnummer des Käufers                                       | Der Kunde; XRechnung erfordert eine Käuferreferenz                                                 |
| Leitweg-ID                                                                     | Deutsche öffentliche Auftraggeber; als Käuferreferenz verwendet                                    |
| Peppol-Teilnehmer-ID                                                           | Der Kunde, wenn er über Peppol                                                                     | erhält |
| Bevorzugtes Format und Kanal                                                   | Der Kunde: XRechnung UBL oder CII, ZUGFeRD, Peppol, E-Mail                                         |
| MwSt.-Kategorie pro Zeile                                                      | Ihr Steuerberater: z.B. Normalsatz (S), Reverse Charge (AE) oder nicht mehrwertsteuerpflichtig (O) |
| Bankverbindung und Währung                                                     | Normalerweise eine IBAN und EUR                                                                    |

Zwei praktische Tipps:

- **Vor dem Senden validieren.** Eine Datei, die die Validierung durch den Käufer nicht besteht, wird abgelehnt, als ob Sie sie nie gesendet hätten, und die Zahlungsfrist beginnt nicht.
- **Archivieren Sie das von Ihnen gesendete XML.** Die strukturierte Datei ist die Originalrechnung, nicht die PDF-Ansicht davon.

## Wie Helvetly hilft

Helvetly exportiert eine ausgestellte Rechnung als XRechnung (UBL oder CII), Peppol BIS Billing, polnisches KSeF FA(3) oder rumänisches e-Factura (RO_CIUS) XML, mit Befreiungscodes für umsatzsteuerbefreite Zeilen. Die Leitweg-ID des Kunden wird auf dem Mandanten gespeichert und in die Käuferreferenz übernommen und jede exportierte Datei wird archiviert. Für die Bereitstellung über das Peppol-Netzwerk selbst ist ein Access Point-Anbieter erforderlich. Der XML-Export von E-Rechnungen ist Teil des Business-Plans; Helvetly selbst liefert keine Rechnungen über Peppol, KSEF oder das rumänische Netzwerk.

## Quellen

- [E-Rechnung: Häufig gestellte Fragen – Bundesministerium der Finanzen](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html)
- [XRechnung – xeinkauf.de (KoSIT)](https://xeinkauf.de/xrechnung/)
- [eInvoicing und EN 16931 – Europäische Kommission](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/eInvoicing)
- [Mehrwertsteuer im digitalen Zeitalter (ViDA) – Europäische Kommission](https://taxation-customs.ec.europa.eu/taxation/vat/vat-digital-age-vida_en)
- [Peppol BIS Billing 3.0 – OpenPeppol](https://docs.peppol.eu/poacc/billing/3.0/)
- [Peppol – OpenPeppol](https://peppol.org/)
- [Zasady obowiązywania KSeF i przepisy prawne – ksef.podatki.gov.pl](https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/)
- [KSeF – Krajowy System e-Faktur](https://ksef.podatki.gov.pl/)
- [Technische Informationen zu RO e-Factura – Rumänisches Finanzministerium](https://mfinante.gov.ro/en/web/efactura/informatii-tehnice)
- [ANAF – Agenția Națională de Administrare Fiscală](https://www.anaf.ro/)
