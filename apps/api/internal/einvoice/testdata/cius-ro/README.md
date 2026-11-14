# CIUS-RO validation artefacts (ANAF)

Official RO e-Factura validation rules, kept byte for byte so `pnpm test:einvoice` validates offline.
`SHA256SUMS` lists every file; `TestCIUSROArtefactsArePinned` checks them.

| Item        | Value                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package     | `ro16931-ubl-1.0.9.zip`, CIUS-RO specification 1.0.1 (`BT-24` ends in `CIUS-RO:1.0.1`)                                                           |
| Source      | https://mfinante.gov.ro/static/10/eFactura/ro16931-ubl-1.0.9.zip (Ministry of Finance, ANAF e-Factura technical pages)                           |
| Retrieved   | 2026-11-09 via the Internet Archive copy of that URL; the ministry host timed out from the build machine                                         |
| ZIP SHA-256 | `818e7dd77e429f5dbde7c60b43dddbdf1a9a82a1773c359caa80a36ef89ea7f2`, identical to the digest an independent validator publishes for the same file |
| Files kept  | `EN16931-CIUS_RO-UBL-validation.sch` and the five files it includes; `preprocessed/` is not used                                                 |
| Examples    | `exemple_Invoice_CreditNote.zip` from the same folder (2022, `CIUS-RO:1.0.0`): an invoice and a credit note                                      |

The examples predate 1.0.1, so the test raises their `CustomizationID` to 1.0.1 and then expects no error: a
check that the rules and the processor run as ANAF's do. The rules are compiled with SchXslt 1.10.1 (Saxon HE,
Maven Central `name.dmaus.schxslt:cli`, pinned by SHA-256 in `scripts/validate-einvoice.sh`).

Not covered by these rules: ANAF's separate check of CUI/CNP check digits (rejected as `ERRIdentif`) and its
signature and upload checks in SPV.
