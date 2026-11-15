# Data processing agreement (Auftragsverarbeitungsvertrag)

**Between** the customer who has accepted the Helvetly terms of service ("Customer", controller)
**and** Helvetly ("Helvetly", processor).

## 1. Subject and duration

Helvetly processes personal data for the Customer to provide the Helvetly platform as described in
the terms of service, for as long as the Customer uses it and as set out in section 9.

## 2. Nature, purpose, data and people concerned

|                    |                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose            | Business administration: managing clients, invoicing, expenses, documents, electronic signatures, engagements, the client portal, the AI assistant Heidi and AI import, e-invoice delivery and emails sent on the Customer's behalf                                                                                                                                      |
| Data               | Names, addresses, email addresses, phone numbers, VAT and registration numbers, bank details (IBAN), invoice and payment data, expense data and receipts, contents of uploaded documents, signatures and their audit trail (including signers' IP address and browser), client portal sign-ins and change requests, Heidi conversations, files and records of AI imports |
| People             | The Customer's clients and their contacts (including people who sign in to the Customer's client portal), suppliers, signers, members and staff of the Customer                                                                                                                                                                                                          |
| Special categories | Not intended. The Customer does not upload sensitive data (nDSG Art. 5 lit. c, GDPR Art. 9) unless necessary and then remains responsible for its lawfulness                                                                                                                                                                                                             |

## 3. Instructions

Helvetly processes the data only on the Customer's documented instructions: the terms of service,
this agreement and the Customer's use of the platform's functions (for example, sending an invoice
or allowing Heidi to use OpenAI). Helvetly informs the Customer if it believes an instruction breaks
data protection law.

## 4. Confidentiality

Everyone at Helvetly with access to Customer data is bound to confidentiality.

## 5. Security (nDSG Art. 8, GDPR Art. 32)

Helvetly takes the technical and organisational measures in the annex and keeps them up to date.

## 6. Subprocessors

The Customer authorises the subprocessors listed in [subprocessors.md](subprocessors.md). Helvetly
informs the Customer 30 days before adding or replacing one; the Customer may object for
important data protection reasons and, if no solution is found, end the contract. Helvetly binds
each subprocessor to obligations equivalent to this agreement and remains responsible for it.
Using OpenAI for Heidi and AI import requires, in addition, the consent an owner or admin gives in
the platform.

## 7. Transfers abroad

Data is disclosed outside Switzerland and the EU/EEA only with a basis under nDSG Art. 16–17 and
GDPR Chapter V (adequacy decision, including the Swiss–US and EU–US Data Privacy Framework for
certified recipients, or standard contractual clauses). The basis for each subprocessor is listed in
[subprocessors.md](subprocessors.md).

## 8. Assistance

Helvetly helps the Customer answer requests from the people concerned (access, correction, deletion,
portability), mainly through the platform's own functions: editing and deleting records, the
workspace export (Settings → Workspace → Export all data) and the account export. Helvetly also
assists with data protection impact assessments and notifications to the authorities where
needed.

## 9. Deletion and return

During the contract the Customer can export all of its data at any time (Settings → Workspace →
Export all data). When a workspace is deleted, nobody can reach it any more, but its records and
files stay stored; the platform does not yet erase them automatically. Keeping business records for
the period the law requires (in Switzerland 10 years, OR Art. 958f, GeBüV) is the Customer's
obligation as controller. Helvetly keeps a deleted workspace's records as an archive until the end of
that retention period and then erases them; on the Customer's request it erases them earlier where
the law allows. Backups are erased in their normal rotation.

## 10. Data breaches

Helvetly notifies the Customer without undue delay, and where possible within 48 hours, after
becoming aware of a breach of data security affecting Customer data (nDSG Art. 24, GDPR Art. 33),
with the information the Customer needs for its own notifications.

## 11. Audits

Helvetly gives the Customer the information needed to show compliance with this agreement and
allows audits by the Customer or an auditor it appoints, with reasonable notice and at most once a
year unless there is a breach.

## 12. Law and jurisdiction

Swiss law applies. Place of jurisdiction is the registered office of Helvetly in Switzerland. Where the GDPR applies, its mandatory
provisions remain unaffected.

## Annex: technical and organisational measures

- **Access:** passwordless sign-in (Google OpenID Connect, one-time email codes, passkeys), optional
  TOTP two-factor with hashed single-use recovery codes and a durable lockout after repeated wrong
  codes; sessions bound to one workspace; session tokens stored only as SHA-256; CSRF tokens on
  every change.
- **Separation:** every query is scoped to the workspace of the session; roles owner, admin and
  member with permission scopes.
- **Integrity:** issued invoices are immutable; financial changes are written to an append-only,
  hash-chained audit log in the same transaction; closed months refuse changes; uploaded files are
  identified by SHA-256; where the storage supports it, issued invoice PDFs, archived e-invoice XML,
  signed PDFs and booked receipts are kept under S3 Object Lock.
- **Availability and resilience:** regular database backups and deployments without downtime.
- **Transport and storage encryption:** TLS for all connections; data at rest encrypted by the
  hosting provider.
- **Logging:** the application logs errors by route, without tokens from URLs; it writes no access
  log. Financial changes and signatures have their own append-only, hash-chained audit trails.
- **Staff access:** the platform has no support or administrator access to workspaces; access to
  production systems is limited to the people who operate the service.
- **AI provider:** off until consented per workspace (consent history kept); only the current
  message, up to 20 earlier turns and explicitly attached files (Heidi) or the uploaded files (AI
  import) are sent; requests ask the provider not to store data (`store: false`); a monthly token
  budget is enforced on the server.
