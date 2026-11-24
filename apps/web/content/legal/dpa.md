# Data processing agreement (Auftragsverarbeitungsvertrag)

**Between** the customer who has accepted the Helvetly terms of service ("Customer", controller)
**and** Helvetly ("Helvetly", processor).

## 1. Subject and duration

Helvetly processes personal data for the Customer to provide the Helvetly platform as described in
the terms of service, for as long as the Customer uses it and as set out in section 9.

## 2. Nature, purpose, data and people concerned

|                    |                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Business administration: managing clients, invoicing, expenses, documents, electronic signatures, engagements, the client portal, the AI assistant Heidi and AI import, e-invoice file exports and emails sent on the Customer's behalf; keeping the Customer's personnel and payroll records (Business plan)                                                                                           |
| Data               | Names, addresses, email addresses, phone numbers, VAT and registration numbers, bank details (IBAN), invoice and payment data, expense data and receipts, contents of uploaded documents, signatures and their audit trail (including signers' IP address and browser), client portal sign-ins and change requests, Heidi conversations, files and records of AI imports; for employees as listed below |
| People             | The Customer's clients and their contacts (including people who sign in to the Customer's client portal), suppliers, signers, members and staff of the Customer, and its current and former employees                                                                                                                                                                                                   |
| Special categories | Not intended. The platform has no fields for health, absence or other special-category data. The Customer does not upload sensitive data (nDSG Art. 5 lit. c, GDPR Art. 9), including in employee documents, unless necessary and then remains responsible for its lawfulness (for employment, GDPR Art. 9(2)(b))                                                                                       |

### Employee and payroll data

On the Business plan the Customer can keep personnel and payroll records. Helvetly stores them only
for the Customer, to keep those records; it does not calculate pay, tax or contributions.

|                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data                | Identity (name, employee number); contact (email, phone, address); employment (position, department, contract type, dates, notice period, working time, place, country and canton of work, residence and social-security country, cross-border status); pay terms and the payroll figures the Customer enters or imports; social-security numbers (such as the Swiss AHV/AVS number or EU social-security numbers); tax identifiers; bank details (IBAN); withholding-tax (Quellensteuer) status and canton; documents the Customer uploads for an employee (such as contracts, payslips, permits) |
| Legal basis         | The Customer's determination as controller. The Customer may rely on, for example, GDPR Art. 6(1)(b) and (c) with Art. 88 and national employment-data law, Art. 9(2)(b) only for special-category data it chooses to upload, the nDSG and Art. 328b OR (only data concerning the employee's suitability for the job or needed to perform the contract), and Art. 50e–50g AHVG for the systematic use of the AHV number, for which the Customer must be authorised; Helvetly stores the number only for the Customer                                                                               |
| Access              | The workspace owner always; other members only as the owner grants per member, separately for Employees and Payroll (no access, view or edit); admins by default only view the payroll register, without sealed fields. Only the owner changes these grants. Optional approval of payroll by a second person                                                                                                                                                                                                                                                                                       |
| Sealed fields       | Bank details, tax identifiers and social-security numbers are encrypted at rest with AES-256-GCM and shown only to the owner and to members with edit access to Payroll; every access to them is logged                                                                                                                                                                                                                                                                                                                                                                                            |
| AI and integrations | Not fetched for AI requests; the Customer must not include these data in AI messages or files; not available through MCP or personal API tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Retention           | Set by the Customer per document, with statutory periods suggested per country (for example payroll books in Switzerland: 10 years, OR Art. 958f). After retention the owner erases or anonymises the data, after reviewing a list of what would be erased; records under legal hold are kept                                                                                                                                                                                                                                                                                                      |
| Plan change         | After a downgrade from the Business plan the data is kept; the owner can read and export it but not change it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 3. Instructions

Helvetly processes the data only on the Customer's documented instructions: the terms of service,
this agreement and the Customer's use of the platform's functions (for example, sending an invoice
or asking Heidi a question). Helvetly informs the Customer if it believes an instruction breaks
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

Each member must approve their own AI use in each workspace before content is sent to the AI
provider, including for token counting. Approval covers all AI tools in that workspace and cannot be
given on another member's behalf. Each approval records the version of the AI notice it was given
for; when the notice changes, earlier approvals stop counting and each member approves the new
version once. A member can withdraw their approval at any time. The approval history is kept. With
approval, a file a member uploads to Documents is also sent to the AI provider in the background for
automatic filing (tags and folder), as described in the privacy policy.

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
files stay stored; the platform does not yet erase them automatically, and no period for erasing
them has been set yet. Keeping business records for the period the law requires (in Switzerland 10
years, OR Art. 958f, GeBüV) is the Customer's obligation as controller. On the Customer's request
Helvetly erases a deleted workspace's data earlier where the law allows. Within 30 days the owner who
deleted the workspace can restore it, with those of its members whose accounts still exist. Shortly
after the deletion a background job also stores an archive copy: a ZIP of the workspace's records
and files with a note of who deleted it, when, and its members, showing the workspace as it is when
the job runs; it is stored like the workspace's records. Employee and payroll data are part of the
workspace: the owner's export and the archive copy include them in a separate folder, and on
deletion they are treated like its other records.

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
- **AI provider:** only the current message, up to 20 earlier turns and explicitly attached files
  (Heidi), the selected files (AI import and receipt reading), the company name (workspace-name
  suggestion), or an uploaded file's name, type and start of its text or the file itself up to
  4 MiB, with folder names and tags in use (automatic filing) are sent, the same content also for
  token counting; only after the member's own approval; requests ask the provider not to keep them
  as stored application state (`store: false`), which does not replace the provider's own retention
  under its terms; a monthly token budget is enforced on the server.
- **Employee and payroll data:** separate per-member access to Employees and Payroll, granted only
  by the owner; bank details, tax identifiers and social-security numbers sealed with AES-256-GCM
  and every access to them logged; not fetched for AI requests; unavailable through MCP or API tokens; optional
  second-person approval of payroll; approved payroll entries can be corrected, not changed.
