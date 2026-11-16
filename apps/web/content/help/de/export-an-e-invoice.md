---
title: E-Rechnung exportieren (XRechnung, Peppol, e-Factura, KSeF)
description: Laden Sie ausgestellte Rechnungen als XRechnung, Peppol BIS 3.0, e-Factura oder KSEF XML herunter und hängen Sie das XML an Rechnungs-E-Mails an.
category: Invoices and getting paid
categoryLabel: Rechnungen und Bezahlung
order: 13
updated: 2026-11-15
---

Einige Kunden und Behörden benötigen Rechnungen als strukturiertes XML. So exportieren Sie sie.

Der XML-Export für E-Rechnungen ist Teil von **Business**. Helvetly erstellt die Dateien; es liefert sie nicht über Peppol, KSEF oder das rumänische Netzwerk.

1. Geben Sie zunächst **Settings → Invoices → E-invoices** ein (Registrierungsnummer, E-Rechnungs-Adressschema und elektronische Adresse).
2. Öffnen Sie eine ausgestellte Rechnung und öffnen Sie das Menü **…**.
3. Wählen Sie unter **E-invoice XML** **XRechnung (UBL)**, **XRechnung (CII)** oder **Peppol BIS 3.0** aus. Sie sehen ausserdem **e-Factura (CIUS-RO)** für einen rumänischen Kunden und **KSeF FA(3)**, wenn Ihr Unternehmen polnisch ist.
4. Laden Sie die heruntergeladene Datei selbst im Empfangsportal hoch, zum Beispiel SPV für e-Factura oder Aplikacja Podatnika für KSeF.
5. Um das XML automatisch anzuhängen, wenn Sie Rechnungen per E-Mail versenden, bearbeiten Sie den Client und wählen Sie das Format unter **E-invoice** aus. Geben Sie für eine deutsche öffentliche Einrichtung zusätzlich **Leitweg-ID** ein.

## Gut zu wissen

- Helvetly sendet keine E-Rechnungen über ein Peppol-Netzwerk oder eine Regierungs-API. Der XML-Export ist nur eine Datei.
- Wenn eine Übertragung vorhanden ist, wird diese in **E-invoice transmissions** auf der Rechnung angezeigt.
