---
title: Die Schweizer QR-Rechnung
description: Was ist die Swiss QR-Rechnung, welche IBAN und Referenz ist zu verwenden, wie ist der Zahlungsteil aufgebaut und welche Fehler führen zur Ablehnung von Rechnungen?
category: Getting paid
categoryLabel: Bezahlt werden
updated: 2026-11-11
readingMinutes: 7
---

Die QR-Rechnung ist der Schweizer Standard-Einzahlungsschein. Er ersetzt die orangen und roten Einzahlungsscheine, deren Bearbeitung bei den Banken am 30. September 2022 eingestellt wurde. Wenn Sie Rechnungen an Kunden in der Schweiz versenden, erwarten Ihre Kunden eines: Sie scannen den Code in ihrer Banking-App und schon sind alle Felder für sie ausgefüllt.

Die Regeln werden von SIX in den Schweizer Umsetzungsrichtlinien zur QR-Rechnung festgelegt. Dieser Leitfaden erklärt, worauf es für ein Kleinunternehmen ankommt.

## Was eine QR-Rechnung enthält

Eine QR-Rechnung ist ein Streifen am Ende der Rechnung (oder auf einer separaten Seite) mit zwei Teilen:

| Teil         | Grösse               | Zweck                                                             |
| ------------ | -------------------- | ----------------------------------------------------------------- |
| Quittung     | 62 × 105 mm, links   | Wird vom Zahler für seine Unterlagen aufbewahrt                   |
| Zahlungsteil | 148 × 105 mm, rechts | Enthält den Swiss QR Code und die gleichen Daten in lesbarem Text |

Zusammen sind sie 210 × 105 mm gross, das untere Drittel einer A4-Seite.

Der **Swiss QR Code** ist 46 × 46 mm gross und hat ein Schweizer Kreuz in der Mitte. Es enthält alle Zahlungsdaten: Ihr Konto, Ihren Namen und Ihre Adresse, den Betrag und die Währung, den Namen und die Adresse des Zahlers, eine Referenz und eine optionale Nachricht. Die Textfelder neben dem Code wiederholen diese Daten, sodass eine Person sie überprüfen oder an einem Postschalter bezahlen kann.

Eckdatengrenzen:

- **Währung:** Nur CHF oder EUR.
- **Betrag:** bis zu 999’999’999.99, oder leer lassen, damit der Zahler ihn ausfüllt.
- **Zusätzliche Informationen:** insgesamt bis zu 140 Zeichen für die unstrukturierte Nachricht und die strukturierten Rechnungsinformationen.
- **Alternative Verfahren:** bis zu zwei Einträge, zum Beispiel eBill.

## QR-IBAN oder IBAN: Auswahl der Referenz

Die wichtigste Entscheidung ist, welcher Konto- und Referenztyp verwendet werden soll. Es gibt drei Kombinationen:

| Konto        | Referenz                                               | Wann sollte man es verwenden                                                            |
| ------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| QR-IBAN      | QR-Referenz (QRR), 27 Ziffern                          | Sie wünschen einen automatischen Zahlungsabgleich und haben von Ihrer Bank eine QR-IBAN | erhalten |
| Normale IBAN | Creditor Reference (SCOR), ISO 11649, beginnt mit „RF“ | Sie möchten einen automatischen Abgleich, verwenden aber ein normales Konto             |
| Normale IBAN | Keine Referenz (NON)                                   | Einfache Gehäuse, geringes Volumen; Der Abgleich erfolgt per Hand                       |

So unterscheiden Sie sie:

- A **QR-IBAN** looks like a normal Swiss IBAN, but the bank identifier (positions 5 to 9) is in the range 30000 to 31999. Your bank issues it for the same account as your normal IBAN.
- Eine **QR-Referenz** besteht aus 27 Ziffern. Die letzte Ziffer ist eine Prüfziffer (Modulo 10, rekursiv), Tippfehler werden also abgefangen.
- Eine **Gläubigerreferenz** beginnt mit „RF“, gefolgt von zwei Prüfziffern und bis zu 21 eigenen Zeichen.

Die Regel, die die meisten Ablehnungen verursacht: **Eine QR-IBAN benötigt immer eine QR-Referenz, und eine QR-Referenz funktioniert nur mit einer QR-IBAN.** Eine normale IBAN erfordert eine Gläubigerreferenz oder keine Referenz.

Mit einer Referenz meldet Ihre Bank jede Zahlung mit dieser Referenz in ihrem elektronischen Kontoauszug (camt.054 oder camt.053), sodass Ihre Buchhaltungssoftware die richtige Rechnung ohne manuelle Arbeit als bezahlt markieren kann.

## Adressen: nur strukturiert

Seit Inkrafttreten der SIX-Richtlinien Version 2.3 im November 2025 akzeptiert der QR-Code nur **strukturierte Adressen** (Adresstyp „S“). Strasse, Hausnummer, Postleitzahl, Ort und Land kommen jeweils in ein eigenes Feld. Der ältere kombinierte Adresstyp („K“), bei dem Strasse und Ort Freitextzeilen waren, ist nicht mehr zulässig. Die gleiche Version ermöglicht auch den erweiterten Zeichensatz der Swiss Payment Standards.

Wenn Ihr Rechnungstool oder Ihre Kundendatensätze Adressen immer noch als Freitextzeilen speichern, beheben Sie das zunächst. Dies ist der häufigste Grund dafür, dass eine mit älterer Software erstellte QR-Rechnung nicht mehr gescannt werden kann.

## Aufbau des Zahlteils

Die Richtlinien legen das Layout fest, sodass jede Rechnung gleich aussieht:

- Oben links der Titel „Zahlungsteil“, darunter der QR-Code.
- Währung und Betrag unter dem Code.
- Rechts: Konto / Zahlbar an, Referenz, Zusätzliche Informationen, Zahlbar durch.
- Wenn der Betrag oder Zahler offen gelassen wird, wird stattdessen ein in der Ecke markiertes leeres Feld gedruckt.
- Schriftarten: Arial, Frutiger, Helvetica oder Liberation Sans, schwarz auf weiss. Überschriften sind fett.
- Auf der Quittung sind das gleiche Konto, die gleiche Referenz, der gleiche Zahler und der gleiche Betrag sowie „Annahmestelle“ aufgeführt.

Etiketten müssen in einer der Sprachen verfasst sein, die die Richtlinien zulassen: Deutsch, Französisch, Italienisch oder Englisch.

## Die Scherenlinie

Quittung und Zahlteil sind abzutrennen und separat zu bezahlen. Wie man das markiert, hängt vom Medium ab:

- **Auf Papier gedruckt:** Die Trennlinien zwischen Rechnung und QR-Rechnung sowie zwischen Quittung und Zahlteil müssen perforiert sein.
- **Als PDF gesendet:** Dieselben Linien werden als durchgezogene oder gestrichelte Linien gezeichnet, mit einem Scherensymbol oder dem Text „Vor Einzahlung trennen“ über der Linie.

## Häufige Fehler

| Fehler                                         | Was passiert                          | Fix                                                                     |
| ---------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------- |
| QR-IBAN mit SCOR oder ohne Referenz            | Zahlung von der Bank abgelehnt        | Verwenden Sie eine QR-Referenz oder wechseln Sie zu Ihrer normalen IBAN |
| Normale IBAN mit QR-Referenz                   | Zahlung abgelehnt                     | Verwenden Sie SCOR oder keine Referenz                                  |
| Unstrukturierte Adresse (Typ K)                | Code nicht mehr gültig                | Strasse, Hausnummer, PLZ und Ort getrennt hinterlegen                   |
| Falsche Prüfziffer in der Referenz             | Code durch Scannen von Apps abgelehnt | Generieren Sie Referenzen in der Software, niemals von Hand             |
| QR-Code verkleinert oder verschwommen gedruckt | Code wird nicht gescannt              | Drucken Sie es im vollen Format von 46 × 46 mm scharf aus               |
| Andere Währung als CHF oder EUR                | Nicht erlaubt                         | Rechnung in CHF oder EUR, wenn Sie eine QR-Rechnung wünschen            |
| Absenderangaben weichen vom Kontoinhaber ab    | Zahlungen verspätet oder angefragt    | Verwenden Sie den genauen Namen und die Adresse, die für das Konto      | registriert sind |

Testen Sie einige Rechnungen mit Ihrer eigenen Banking-App, bevor Sie den ersten Stapel versenden, und noch einmal nach einem Software-Update.

## eBill vs. QR-Rechnung

eBill ist der Schweizer elektronische Rechnungsdienst von SIX. Die Rechnung landet direkt im E-Banking des Kunden und der Kunde gibt sie mit einem Klick frei. Es gibt kein PDF zum Herunterladen und keinen Code zum Scannen.

|                      | QR bill                                  | eBill                                                        |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| Lieferung            | Papier oder PDF, per Post oder E-Mail    | Im E-Banking des Zahlers                                     |
| Zahleraktion         | Code scannen, bestätigen                 | Im E-Banking freigeben                                       |
| Wer kann es erhalten | Jedermann                                | Zahler, die bei Ihrem Unternehmen für eBill registriert sind |
| Einrichtung für Sie  | Ein Bankkonto (und eine QR-IBAN für QRR) | Ein Vertrag mit einem eBill-Netzwerkpartner                  |

Sie ergänzen sich. Viele Unternehmen bieten eBill für Kunden an, die sich dafür registriert haben, und senden allen anderen eine QR-Rechnung. Eine QR-Rechnung kann auch über das Feld „Alternative Verfahren“ die Verfügbarkeit von eBill ankündigen.

## Wie Helvetly hilft

Helvetly fügt jeder Rechnung in CHF oder EUR eine QR-Rechnung hinzu, mit einer QR-Referenz für eine QR-IBAN oder einer Gläubigerreferenz für eine normale IBAN und strukturierten Adressen. Für Mahnungen und Ratenzahlungspläne gibt es eine eigene QR-Rechnung: eine für den ausstehenden Betrag auf jeder Mahnung und eine mit eigener Referenz für jede Rate.

## Quellen

- [QR-Rechnung – SIX](https://www.six-group.com/en/products-services/banking-services/payment-standardization/standards/qr-bill.html)
- [Schweizer Umsetzungsrichtlinien für die QR-Rechnung, Version 2.3 – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-v2.3-en.pdf)
- [QR-Rechnung Version 2.3 Delta-Leitfaden – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/ig-qr-bill-delta-guide-v2.3-en.pdf)
- [Neue Anforderungen an die QR-Rechnung: Factsheet für KMU – SIX](https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/factsheet-qr-bill-transition-period-sme-en.pdf)
- [eBill – SIX](https://www.ebill.ch/en/)
