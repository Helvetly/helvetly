# Privacy policy

## 1. Who we are

Helvetly ("Helvetly", "we") runs the
website helvetly.com, the documentation at docs.helvetly.com, the Helvetly platform and the client
portal. Contact for data protection: [support@helvetly.com](mailto:support@helvetly.com).

Helvetly is a service for businesses. It is not directed at children.

## 2. Two roles

- **Controller** for the data of people who use Helvetly: account and sign-in data, billing of
  Helvetly plans, security data, feedback and support requests, and the website.
- **Processor** for the business data our customers keep in their workspaces: their clients and
  contacts (including the people who sign in to a customer's client portal), invoices, expenses,
  documents, signature requests and signers, engagements, AI imports, Heidi conversations, and the
  personnel and payroll records of their employees. The customer is the controller of that data; we
  process it only on their instructions, under the [data processing agreement](dpa.md). If you are a
  customer's client, contact, signer or employee, please contact that customer about your data.

**Employee and payroll data.** A customer on the Business plan can keep its personnel and payroll
records in Helvetly: identity (name, employee number), contact details, employment details
(position, department, contract type, dates, notice period, working time, place and country of
work, residence and social-security country, cross-border status), pay terms and the payroll figures
the customer enters or imports, social-security numbers (such as the Swiss AHV/AVS number), tax
identifiers, bank details, withholding-tax status and canton, and the documents the customer uploads
for an employee (such as contracts, payslips or permits). Helvetly does not calculate pay, tax or
contributions, stores no health or absence data, and has no fields for other special categories of
data; documents the customer uploads may contain such data, which is the customer's responsibility.
Helvetly does not fetch employee or payroll records for OpenAI requests. These records are not
available through MCP or personal API tokens. Which legal basis applies (for example under GDPR Art. 6(1)(b) and (c) and Art. 88, the nDSG,
Art. 328b of the Swiss Code of Obligations, or Art. 50e–50g AHVG for the AHV number) is for the
customer to determine as controller; the [data processing agreement](dpa.md) describes the details.

## 3. What we process as controller, why, and on what basis

| Data                                                                                                                                                                                                            | Purpose                                             | Basis (GDPR)                                                         | Kept for                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Email address, name, profile picture (from Google, if used, or a photo you upload), sign-in identities, passkeys (public keys only), two-factor settings (secret encrypted with AES-GCM; recovery codes hashed) | Creating and securing your account, signing you in  | Contract (Art. 6(1)(b))                                              | Until you delete your account; then sign-in data is deleted and the profile anonymised (email replaced, name and photo removed) |
| Sessions: browser, operating system, IP address, sign-in time, last activity                                                                                                                                    | Showing your active sessions, ending them, security | Legitimate interest in security (Art. 6(1)(f))                       | Until the session ends or expires (30 days by default); expired sessions are removed                                            |
| One-time sign-in codes and failed two-factor attempts                                                                                                                                                           | Preventing account takeover                         | Legitimate interest (Art. 6(1)(f))                                   | Codes: valid for minutes, removed after 24 hours; failed attempts: until the next successful sign-in                            |
| Personal API tokens: name, scopes, first characters, creation and last use (the token itself only as a SHA-256 hash)                                                                                            | Letting you connect your own tools                  | Contract                                                             | Until you revoke the token or it expires; refused once your account is closed                                                   |
| Workspace owner's email, workspace name, billing address and tax number entered at checkout, plan, seats and payment status (card data stays with Stripe)                                                       | Billing Helvetly plans                              | Contract; legal obligation to keep accounting records (Art. 6(1)(c)) | 10 years for accounting records (Swiss Code of Obligations Art. 958f)                                                           |
| Who started a free trial, as one-way digests of the account, its email and the card's fingerprint (never the card)                                                                                              | Giving each customer one trial                      | Legitimate interest in preventing trial abuse (Art. 6(1)(f))         | 24 months from the trial's start, then deleted                                                                                  |
| Feedback and problem reports: your description, the page you were on, up to five screenshots, your account and workspace                                                                                        | Answering you and improving Helvetly                | Legitimate interest (Art. 6(1)(f))                                   | 2 years after the report is closed; reports are also emailed to our team's inbox                                                |
| Emails we send you: sign-in codes, invitations, notices, security alerts, digests                                                                                                                               | Running the service                                 | Contract                                                             | As long as the email provider keeps its delivery logs                                                                           |
| Error logs (route, error, time) and the logs of our hosting provider (which can contain IP addresses)                                                                                                           | Operating and securing the service                  | Legitimate interest                                                  | 30 days. The application itself writes no access log; it logs errors without tokens from URLs                                   |

We do not sell personal data, do not use it for advertising, do not profile you and make no decisions
about you by automated means alone (nDSG Art. 21, GDPR Art. 22).

**Cookies and browser storage.** The website (www.helvetly.com) uses Google Analytics 4 to count visits and see
which pages and channels bring visitors; it sets Google's `_ga` cookies (up to 2 years) and sends page views and device
data to Google, which uses the IP address only to derive an approximate location and does not store it (legitimate interest, Art. 6(1)(f)). Blocking
cookies or scripts in your browser turns it off. The documentation sets no cookies and uses no analytics,
advertising or tracking. The platform (app.helvetly.com) uses Google Analytics 4 the same way, but sends only the
address of each page without its query or fragment, never what you enter or the data in your workspace. The client
portal loads no analytics. Apart from Google's `_ga` cookies, the platform and the client portal set only cookies
that are strictly necessary for signing in:

| Name                      | Set by        | Purpose                                                | Lifetime                       |
| ------------------------- | ------------- | ------------------------------------------------------ | ------------------------------ |
| `helvetly_session`        | Platform      | Keeps you signed in                                    | Until you sign out, or 30 days |
| `helvetly_login`          | Platform      | Protects a sign-in with Google while it is in progress | 10 minutes                     |
| `helvetly_portal_session` | Client portal | Keeps a customer's client signed in to the portal      | Until sign-out or expiry       |

The platform also keeps display preferences in your browser's local storage (for example a
collapsed sidebar, chosen table columns, the dashboard period, a dismissed notice). They never leave
your browser. The documentation's API playground keeps an API token you paste only in that browser
tab's session storage.

## 4. Heidi, AI import and OpenAI

You approve AI use once for yourself in each workspace. Your approval covers all AI tools in that
workspace; it does not approve another member or carry over to another workspace. Declining or
closing the approval dialog starts no AI action.

Heidi answers many questions from your workspace's records without any outside service. For other
questions, and for **AI import** (reading uploaded files and proposing records), Helvetly uses
OpenAI's API (OpenAI, USA) only after your own approval for this workspace. AI import is available
on the plans that include it.

What is sent:

- Heidi sends the message you write, up to 20 earlier messages of that conversation (which can
  contain figures Heidi showed you) and files you attach to that message. A short check of whether
  the message is about Helvetly or your business, and a count of the tokens the request will use,
  are sent to OpenAI as well.
- AI import and receipt reading send the content of the files you choose, part by part.
- The workspace-name suggestion sends only the company name you enter.

Helvetly does not fetch Employees or Payroll records for AI requests. Do not include employee or
payroll data in messages or files you send for AI processing.

We ask OpenAI not to store requests and responses (`store: false`). According to OpenAI's API terms,
API data is not used to train models and may be kept for up to 30 days to detect abuse. Heidi is labelled as an AI assistant; its answers and imported
records can be wrong and are suggestions for you to check.

## 5. Recipients and transfers abroad

The services that process data for us are listed in [subprocessors.md](subprocessors.md). Some are
in the USA (Stripe, Google, OpenAI, Cloudflare). We disclose data abroad only where nDSG Art. 16–17
and GDPR Chapter V allow it: to countries the Federal Council or the European Commission recognise
as adequate (for the USA, companies certified under the Swiss–US and EU–US Data Privacy Framework),
or under the standard contractual clauses recognised by the FDPIC and the European Commission.

Helvetly sends nothing to tax authorities or e-invoicing networks: customers download VAT returns
and e-invoice files and submit them themselves.

## 6. Your rights

You can ask for access to your data (nDSG Art. 25, GDPR Art. 15), have it corrected or deleted, object
to or restrict processing, and receive it in a common machine-readable format (nDSG Art. 28, GDPR
Art. 20). We answer within 30 days (GDPR: one month, extendable where the law allows). Most of this
you can do yourself:

- **Download your data:** Account settings → Your data gives a JSON file with your profile,
  sign-in methods, passkeys, sessions, API tokens (without the tokens), workspaces, your Heidi
  messages and the feedback you sent.
- **Workspace data:** an owner downloads everything a workspace holds (records and files) as a ZIP
  in Settings → Workspace → Export all data, including employee and payroll data in a separate
  folder.
- **Delete your account:** Account settings → Delete account. Your sign-in methods, sessions and
  memberships are deleted and your profile anonymised. What you wrote in a workspace (for example
  Heidi conversations or records you created) belongs to that workspace and stays there without your
  name or address; ask the workspace's owner, or us, if you want it removed.

The owner who deleted a workspace can restore it within 30 days. On deletion we also store an archive copy
(a ZIP of all its records and files), kept with the archive for the retention period below.

A deleted workspace can no longer be reached by anyone, but its records stay stored: records that
accounting law requires to be kept (invoices, receipts, the audit log: 10 years, OR Art. 958f and
GeBüV) are kept for that period, and only for that purpose, and then erased. Write to
[support@helvetly.com](mailto:support@helvetly.com) for anything else; we may
ask you to confirm your identity first. You may complain to the Federal Data Protection and
Information Commissioner (FDPIC, www.edoeb.admin.ch) or, in the EU, to your national data protection
authority.

## 7. Security

Passwordless sign-in (Google, email codes, passkeys) with optional two-factor authentication;
session and API tokens stored only as SHA-256 hashes; encrypted connections; every workspace's data
is separated in every query; financial records in an append-only, hash-chained log; where storage is
configured for it, issued invoices and booked receipts are locked against deletion (S3 Object Lock);
data at rest is encrypted and backed up regularly.

## 8. Changes

We publish changes here with their date. Last change: 16 November 2026.
