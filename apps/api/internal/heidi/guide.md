# Helvetly user guide

## Get around Helvetly (sidebar, Quick Actions, + button, Heidi)

Keywords: navigate, menu, sidebar, search, shortcut, command palette, cmd k, quick actions, plus, create, theme, dark mode, mobile

1. The left sidebar has two groups. **Work** holds Dashboard, Clients, Invoices, Products & services, Expenses, Engagements and Documents. **Team** holds Members. Help & feedback, Ask Heidi and Notifications sit at the bottom.
2. To open **Quick Actions**, click the button at the top of the sidebar, or press ⌘K (Ctrl+K on Windows) or `/`. Type to find a page, a client (by name or number) or an action.
3. Quick Actions has three groups. **Go to** lists the pages. **Create** has New invoice, New expense, New client, New engagement and New product. **Theme** switches between Light, Dark and System.
4. To ask the assistant, press ⌘J (Ctrl+J) or click **Ask Heidi** in the sidebar. Press it again to close the panel.
5. To switch workspace, click the workspace name at the top left. To reach your settings, click your name at the bottom left and choose **Settings**, **Help & feedback** or **Log out**.
6. On a phone, the bottom bar shows Home, Invoices, Clients, a **+** button and **Menu**. **+** runs the current page's main action, such as New invoice on Invoices. On pages without one, it lists what you can create.
   You only see pages your access allows. "Upload document" and "Invite member" in Quick Actions only say "coming soon". Use the Documents and Members pages for those.

## Keyboard shortcuts

Keywords: keyboard, shortcut, shortcuts, hotkey, keys, cmd b, ctrl b, hide sidebar, toggle sidebar, switch theme

1. Press `?` to see every shortcut, or click your name at the bottom left and choose **Keyboard shortcuts**.
2. ⌘K or `/` opens Quick Actions. ⌘J opens or closes Heidi. ⌘B shows or hides the sidebar. On Windows and Linux, use Ctrl instead of ⌘.
3. `H` opens Help & feedback. `G` then `N` goes to Notifications. `D` switches the theme: light, dark, then system. `N` starts a new record, like the page's **New** button.
4. Single keys only work when you are not typing in a field and no dialog or menu is open.

## Add a client

Keywords: client, customer, new client, kunde, add customer, address, VAT number, UID
Pages: /clients

1. Go to **Clients** and click **New client**. You can also use Quick Actions → New client.
2. Choose the **Client type** (company or person) and enter the name. Only the name is required.
3. Under **Address**, fill in the street, number, ZIP, city and country. You need the address before you can issue an invoice to this client.
4. Optionally add the **VAT / UID number** and the business registration number. Under **Billing defaults**, set the document language, currency and payment terms.
5. Click **Add client**. To change it later, open the client and click **Edit**.
   A client without a full address shows as a draft. You can draft invoices for it but not issue them. In the client's **More actions** (…) menu you can deactivate the client, which hides it from pickers. Owners and admins can also delete it there.

## Add contact persons to a client

Keywords: contact, contact person, people, primary contact, ansprechpartner, email, phone

1. Open the client from **Clients** and go to the **Contacts** tab.
2. Click **Add contact**, enter a name and optionally an email and phone, then click **Add contact**.
3. To edit, remove or **Make primary**, use the **Actions** (…) menu next to the contact.
   When you remove the primary contact, the longest-standing other contact becomes primary.

## Give a client access to the client portal

Keywords: portal, client portal, customer login, give access, kundenportal, share invoices with client

1. Open the client. On the **Overview** tab, turn on the **Client portal** switch.
2. The client signs in with its email, or its billing email when it has no email, using a code sent to that address. Contacts are not portal logins.
3. Turning the portal on emails the client an invitation. The **Invitation** row shows **Not sent**, **Sent** with the date or **Signed in** with the date; **Send invitation** or **Resend** emails it again.
4. The **Portal** row has the portal's address with buttons to copy or open it. The portal shows issued invoices (PDF), engagements, documents you shared and the client's details.
   Turning the switch off, or changing the client's email, signs the client out of the portal right away.

## Share a document with a client

Keywords: share, share document, portal, send file to client, client files, freigeben

1. Go to **Documents** and find the file.
2. Click the **Share with client** icon on the file, or right-click it and choose **Share with client…**.
3. Choose a client and click **Share**. To stop sharing, remove the client in the same panel.
4. The document then appears in that client's portal.
   The client also needs **Client portal** turned on and an email address. Documents in the Trash are not shown in the portal.

## Approve or reject a client's change request

Keywords: change request, client changed address, portal request, approve, reject, update billing details

1. When a portal contact asks to change their details (name, billing email, phone, address, VAT or registration number), owners and admins get a notification.
2. Open the client. A banner shows the requested changes.
3. Click **Approve** to apply them, or **Reject**.
   Only owners and admins can decide. Invoices that are already issued keep the old details.

## Add products and services to your catalogue

Keywords: product, service, catalogue, price list, item, SKU, artikel, leistung, archive product
Pages: /products

1. Go to **Products & services** and click **New item**.
2. Choose the **Item type**: **Service** or **Product**.
3. Enter the **Name** and an optional **Description**, which is printed under the name on invoice lines.
4. Under **Price**, enter the **Unit price** and choose **Net** or **Gross**. Then set the currency, VAT category and VAT rate.
5. Under **Details**, you can set a **Unit**, an **SKU** and a **GTIN / EAN**. Click **Add item**.
6. In an invoice, click **Add from catalogue** to insert the item as a line.
   To hide an item without deleting it, select it and click **Archive**. It moves to the **Archived** tab, and **Restore** brings it back. If an item's currency differs from the invoice's, you type the price yourself.

## Create and issue an invoice

Keywords: invoice, issue, bill, new invoice, rechnung, faktura, draft, create invoice, number
Pages: /invoices, /invoices/new, /invoices/edit

1. Go to **Invoices** and click **New invoice**. You can also use Quick Actions or the **Invoice** button on a client.
2. Under **Bill to**, click **Choose a client**.
3. Check the **Issue date**, **Due date**, **Service** dates and an optional **Reference** (PO number).
4. Add lines with **Add line** (or press Enter) or **Add from catalogue**. Above the document you can set **Currency**, **Document language** and **VAT**. You can also add a **Discount**, an introduction, a footer and an **Internal note** (never printed).
5. The draft saves by itself (⌘S saves now). Click **Preview** (⌘P) to see the PDF.
6. Click **Issue invoice** and confirm. The invoice gets the next number and its PDF is stored.
   Issuing cannot be undone. An issued invoice can't be edited, so fixes go through a credit note or a correction. If anything is missing, Helvetly lists what to fix with a link, such as **Open invoice settings** or **Complete the client**.

## Make a quote (Offerte) and turn it into an invoice

Keywords: quote, quotation, offer, offerte, offerta, offre, estimate, angebot, accept quote, decline quote, revise quote, quote to invoice
Pages: /quotes

1. Go to **Quotes** and click **New quote**, or click **New quote** in the Quotes section on a client's page.
2. Choose the **Client**, check the **Date** and **Valid until** (30 days by default), and add lines like on an invoice. **Currency**, **Document language**, **VAT**, an **Introduction** and a **Reference** are optional.
3. Click **Send quote**. The quote gets its number (Q-2026-001) and the client gets an email with the PDF. With **Mark as sent without email** you hand it over yourself.
4. The client can **Accept** or **Decline** it, with a note, in the client portal; owners and admins are notified. You can also record the answer yourself with **Accept** or **Decline**.
5. Open an accepted quote and click **Create invoice**. An invoice draft opens with the same lines; each quote becomes one invoice.
   After **Valid until** a sent quote shows as expired and the client can no longer accept it. Click **Revise** on a sent, expired or declined quote to change it and send it again under the same number (Rev. 2).

## Choose another document type (credit note, proforma, prepayment and more)

Keywords: credit note, gutschrift, proforma, prepayment, deposit, anzahlung, partial invoice, debit note, corrected invoice, correction, self-billed, document type, convert proforma

1. To start a partial invoice, prepayment invoice, proforma invoice or self-billed invoice, click the arrow next to **New invoice** on **Invoices** and pick the type.
2. A credit note, debit note or corrected invoice is always made from an issued invoice. Open that invoice, open the **…** menu and choose **Create credit note**, **Debit note** or **Correct**. A draft opens for you to adjust and issue.
3. To turn a proforma into a real invoice, open it and click **Convert to invoice** or **Convert to prepayment**. The proforma itself stays as it is.
4. To deduct a paid prepayment, create a normal invoice for the same client and pick the prepayment below the document. It is subtracted from the amount due.
5. Each type has its own tab at the top of **Invoices**: Invoices, Partial invoices, Prepayments, Debit notes, Corrections, Credit notes, Proforma and Self-billed.
   A corrected invoice replaces the original once you issue it, and any payments move over. A self-billed invoice is paid out by you. You can record self-billing agreements on the client's **Overview** tab, under **Self-billing agreements**.

## Get a Swiss QR bill on your invoices

Keywords: QR bill, QR-Rechnung, Einzahlungsschein, payment slip, QR-IBAN, QR reference, swiss qr

1. Go to **Settings → Invoices** (owners and admins).
2. Under **Bank account**, enter your **IBAN**. A CH or LI IBAN is needed for a QR bill.
3. Under **Payment methods**, turn on **Swiss QR bill**.
4. New CHF and EUR invoices then get a payment slip on its own page. In the invoice editor, the **Payment** note says "QR bill attached".
   With a QR-IBAN, CHF invoices get a QR reference your bank matches automatically. A QR-IBAN works for CHF only, so EUR invoices need a normal IBAN. Each invoice can turn payment methods on or off above the document.

## Send an invoice by email

Keywords: send, email invoice, mail, deliver, resend, send again, recipients, cc, mark as sent, sent without email

1. Open the issued invoice from **Invoices**.
2. Click **Send**, or choose **Send by email** / **Send again** in the **…** menu.
3. Check **To**, which defaults to the client's billing email. Optionally fill in **Cc**, **Subject** and **Message**, then send.
4. The **Emails** tab of the invoice shows each email that went out, when and by whom.
   You can add up to 10 addresses in To and up to 10 in Cc. To send the PDF yourself, click **Download PDF**, then **Mark as sent without email** in the Send dialog: the invoice shows as sent, and no email goes out.

## Record a payment

Keywords: payment, paid, mark as paid, received money, zahlung, bezahlt, record payment

1. Open the invoice and click **Record payment**. You can also find it in the row's **…** menu on the list.
2. Enter the **Amount** and **Paid on** date, or click **Mark fully paid today**.
3. Optionally choose the **Payment method** and add a note that only your team sees.
4. Click **Record payment**. The status changes to Paid once nothing is due.
   The amount can't be more than what is still due, and the date can't be in the future. To fix a mistake, open the **Payments** tab and delete the payment.

## Record a refund

Keywords: refund, pay back, overpaid, rückerstattung, money back, refund due

1. When a client paid more than they owe, for example after a credit note, the invoice shows a refund due.
2. Open the invoice and click **Record refund**.
3. Enter the **Amount**, the **Refunded on** date and optionally the **Refund method** and a note.
4. Click **Record refund**.
   Use the **Refund due** filter on **Invoices** to find these invoices.

## Void an invoice

Keywords: void, cancel invoice, storno, stornieren, annul, delete issued invoice

1. Open the issued invoice and open the **…** menu.
2. Choose **Void** and confirm with **Void invoice**.
3. A full credit note is issued against it and nothing is owed any more.
   Only owners and admins can void, and only open invoices with no payments and no credit notes. Voiding cannot be undone. Drafts are not voided: use **Delete draft** instead. A draft has no number, so nothing goes missing in your numbering.

## Let a client pay in instalments (one invoice, several due dates)

Keywords: instalments, installments, payment schedule, raten, ratenzahlung, pay in parts, due dates

1. In the invoice editor, turn on **Pay in instalments** below the document.
2. Set the number of instalments, the interval and the **First due date**. You can adjust the rows.
3. Optionally keep **Payment reminders** on. The client is then emailed before and after each due date.
4. Issue the invoice as usual. The invoice detail shows the instalment schedule.
   You set the defaults in **Settings → Invoices → Instalments**. Invoices with instalments are not part of dunning.

## Split an invoice into instalment invoices (instalment plan)

Keywords: instalment plan, split invoice, one invoice per instalment, partial invoices, teilrechnungen

1. Create a draft invoice with its client and lines. Leave **Pay in instalments** off.
2. Click **Split into instalment invoices**, either below the document or in the draft's **…** menu.
3. Set **Instalments** (2 to 12), **Every**, **First due date** and **Issue days before due**. Choose whether to **Send automatically**.
4. Click **Create plan**. Helvetly issues one partial invoice per instalment on schedule.
5. Manage the plan from the **Instalment plan** card on the invoice: pause, resume or cancel.
   Cancelling a plan leaves already issued invoices as they are. While a plan exists, its source draft can't be edited or issued.

## Send payment reminders (dunning)

Keywords: dunning, reminder, mahnung, overdue, late payment, payment reminder, fee, interest

1. Go to **Settings → Invoices → Dunning** and turn on **Send reminders automatically**.
2. Set up to three levels. For each level, set when it is **Sent**, an optional **Fee** and **Own text**. Optionally set **Default interest**.
3. Overdue invoices then get each level once, by email to the client's billing address, with a QR bill for the total.
4. To act on one invoice, open it. The reminders card lets you **Send … now**, **Pause** or **Resume**. Each sent letter opens as a PDF.
5. To leave a client out, edit the client and turn off **Payment reminders**.
   Dunning applies only to invoices without instalments. You can send a reminder by hand even when automatic sending is off.

## Export an e-invoice (XRechnung, Peppol, ZUGFeRD / Factur-X, e-Factura, KSeF)

Keywords: e-invoice, xml, xrechnung, peppol, zugferd, factur-x, facturx, pdf/a-3, e-factura, ksef, einvoice, electronic invoice, leitweg

1. First fill in **Settings → Invoices → E-invoices** (registration number, e-invoice address scheme and electronic address).
2. Open an issued invoice and open the **…** menu.
3. Under **E-invoice XML**, pick **XRechnung (UBL)**, **XRechnung (CII)**, **Peppol BIS 3.0** or **ZUGFeRD / Factur-X (PDF)**: the issued PDF as PDF/A-3 with the EN 16931 XML inside, one file for people and software. You also see **e-Factura (CIUS-RO)** for a Romanian client and **KSeF FA(3)** if your company is Polish.
4. Upload the downloaded file in the receiving portal yourself, for example SPV for e-Factura or Aplikacja Podatnika for KSeF.
5. To attach the XML automatically when you email invoices, edit the client and choose the format under **E-invoice**. With ZUGFeRD / Factur-X the email carries that PDF in place of the plain one. For a German public body, also enter the **Leitweg-ID**.
   Helvetly does not send e-invoices through a Peppol network or government API. The XML export is only a file. If a transmission exists, it shows in **E-invoice transmissions** on the invoice.

## Set up an engagement (retainer or recurring work)

Keywords: engagement, retainer, recurring, contract, abo, hours package, subscription work, mandat
Pages: /engagements

1. Go to **Engagements** and click **New engagement**.
2. Under **Client & service**, pick the **Client** and enter a **Title**.
3. Under **Scope**, set the quantity per period and the **Unit**, for example 30 hours.
4. Under **Schedule**, choose **One-off** (a fixed period) or **Recurring**, then set **Every** and **Starts**.
5. Under **Price & VAT**, choose **Billing**: **Advance** (invoice the period upfront) or **Arrears** (invoice what was delivered afterwards). Then set the currency, price and VAT.
6. Under **Details & automation**, you can carry unused quantity over and **Create invoice drafts automatically**. Click **Create engagement**.
   Nothing is sent or issued without you. Automatic drafts still wait for you to issue them.

## Log work on an engagement

Keywords: log work, log hours, time tracking, entry, delivery, stunden erfassen, timesheet

1. Open the engagement from **Engagements**.
2. Under **Log delivery**, enter the quantity and a note ("What was done?"), then press Enter or click **Log**.
3. Logged entries appear under **Entries**. Use the edit and delete icons to fix one.
4. The **Current period** card shows what was used, what is left and the pace.
   Anything beyond what is left is saved as overage. You can also ask Heidi to log work. She shows what she will save and asks you to confirm.

## Invoice an engagement and send a service report

Keywords: invoice engagement, invoice upfront, invoice usage, arrears, advance, service report, leistungsnachweis, report

1. Open the engagement and scroll to **Periods**.
2. For Advance billing, click **Invoice upfront** on a period. For delivered work, click **Invoice usage**. The arrow next to it offers the other line style (one summary line or one line per entry).
3. A draft invoice opens. Check it and issue it.
4. To share the work done, click **Download report** or **Send report**. Fill in To, Cc, Subject and Message, then send.
   If part of an upfront period was not delivered, the period offers **Issue a credit note?**. Use **Renew**, **Cancel engagement** or **Resume** in the engagement's **…** menu.

## Add an expense with a receipt

Keywords: expense, receipt, beleg, quittung, ausgabe, spesen, cost, supplier invoice, book expense
Pages: /expenses

1. Go to **Expenses** and click **New expense**.
2. Under **Receipt**, drop the receipt file or click to choose it. PDF or photo, up to 20 MB.
3. Under **Details**, fill in the **Supplier**, **Receipt date**, **Category** and **What for**. Under **Amounts**, enter the lines **Incl. VAT** or **Excl. VAT**.
4. Under **Input tax**, choose how much VAT is reclaimable: **Full**, **Partial** or **None**.
5. Under **Payment**, choose **Paid** or **Not paid yet**. If you paid it yourself, turn on **I paid this myself**.
6. Click **Save draft**, or **Save and book** when everything is complete.
   Booking needs the starred fields and a receipt. Booked expenses can't be deleted. An owner or admin can **Void…** them with a reason, and **Duplicate** books a corrected copy.

## Turn receipts into expenses automatically

Keywords: upload receipts, scan receipts, ai receipts, bulk receipts, read receipts, import expenses

1. Go to **Expenses** and click **Upload receipts**, or drop the files onto the page.
2. Click **Read files**. AI reads each receipt into a draft expense.
3. Check the rows, edit any that need it, and click **Import**.
4. Open each draft, check it and click **Book**.
   This needs AI to be allowed for the workspace (see "Use Heidi"). It uses the monthly AI allowance.

## Mark expenses paid or reimbursed

Keywords: mark paid, unpaid, reimburse, out of pocket, pay back employee, to reimburse, overdue expense

1. Go to **Expenses**. Use the tabs **To review**, **Unpaid** and **To reimburse** to find what needs action.
2. Select expenses and click **Mark paid** or **Mark unpaid**. Or open one, click **Edit** and change **Payment**.
3. For out-of-pocket expenses, edit the expense and fill in **Reimbursed on** when the company pays it back.
   Expenses with a due date that are still unpaid after it show as overdue.

## Organize documents (upload, folders, move, star)

Keywords: documents, files, upload, folder, dokumente, ablage, move file, rename, star, storage
Pages: /documents

1. Go to **Documents** and click **Upload**, or drag files onto the page.
2. To make a folder, click **Create → New folder**.
3. Right-click a file for **Download**, **Rename** (F2), **Move to…**, **Copy to…**, **Cut** or **Move to Trash**.
4. Star folders to keep them under **Starred** in the left panel. Use **Types**, **Recent**, **Templates** and **Signatures** there to filter.
5. Use the search box and the **Filter** and **Sort** buttons to find files.
   You can also upload files on a client's **Files** tab. They are linked to that client.

## Restore or permanently delete files (Trash)

Keywords: trash, deleted files, restore, recycle bin, papierkorb, delete forever, empty trash

1. Go to **Documents** and click **Trash** in the left panel.
2. Select items and click **Restore** to bring them back, or **Delete forever**.
3. **Empty Trash** removes everything in it.
   Items are deleted for good 30 days after they were moved to the Trash. Business records that must be kept stay.

## Make a template and fill it for a client

Keywords: template, vorlage, contract template, letter, offer, fill template, generate document, mail merge

1. Upload the contract or letter as a PDF in **Documents**. Export it from Word or Google Docs as PDF first.
2. Click **Create → Template…** (or right-click the PDF → **Make a template…**). Go through **Document**, **Signing** and **Place fields** to put the client's details, and optionally signature fields, on it.
3. To use it, open **Templates** and choose **Use for a client…** from the template's menu. Or click **Document** on a client.
4. Go through **Template & client**, **Fill in** and **Send**. Choose **Save to Documents**, **Email it to the client** and/or **Send for signature**.
   Use **Edit template** or **Delete** in the template's menu to change it.

## Send a PDF for signature

Keywords: signature, e-signature, sign, unterschrift, sign pdf, signing, docusign, remind signer, revoke

1. Go to **Documents** and click **Create → PDF for signature…**. Or right-click a PDF → **Send for signature…**.
2. Under **Document**, pick the PDF and add a title and message.
3. Under **Signers**, add each person's name and email with **Add signer** (or pick a contact). Set the **Signing order** and **Expires after**.
4. Under **Place fields**, put each signer's fields on the pages.
5. Under **Review & send**, check everything and click **Send for signature**.
6. Follow progress under **Signatures**. A request offers **Remind**, **Revoke** and **Download PDF**, plus an audit trail.
   The PDF you send is frozen, so later changes to the file don't affect it. You can add up to 10 signers.

## Import records with AI (clients, products, engagements, invoices, expenses)

Keywords: import, ai import, migrate, spreadsheet, csv, excel, bulk upload, bring data, from old system

1. Open **Clients**, **Products & services**, **Engagements** or **Invoices** and choose **Import** in the page's **…** menu. For expenses, use **Upload receipts**.
2. Drop spreadsheets, PDFs, photos or Word files, or a ZIP of them, then click **Read files**. One import takes up to 25 files of 25 MB each; a ZIP may hold up to 250 files, and one import reads at most 250 files in all.
3. Review the records found. Edit a row, untick any you don't want and resolve conflicts.
4. Click **Import** to create the selected records, then **Done**.
5. You can also attach files in Heidi and pick "Import as". The import drawer then opens with those files.
   This needs AI to be allowed by an owner or admin, and it uses the monthly AI allowance. If your old system already declared VAT for imported invoices, close those months in **Books → Closing** first.

## Set up company details (name, legal form, address, VAT, logo, IBAN)

Keywords: company settings, company details, seller, legal form, Rechtsform, GmbH, AG, Einzelunternehmen, sole proprietor, address, UID, registration number, logo, IBAN, QR-IBAN, bank, VAT registered, MWST
Pages: /settings/company

1. Go to **Settings → Company** (⌘, or Ctrl+, opens Settings; Company is the tab after Workspace).
2. Fill in **Logo** and **Company**: name, **Legal form** (from the forms of your country), business registration number, address, email and phone. Invoices, quotes, payroll, e-invoices and the client portal all use these details.
3. Under **VAT**, turn on **Registered for VAT**, then add your UID with MWST, the default rate and whether prices are entered net or gross.
4. Under **Bank account**, enter your **IBAN** and bank.
5. When the checklist shows **Ready to issue invoices**, you're done. Only owners and admins can change these.

## Set up invoice settings (numbering, payment methods, defaults, dunning)

Keywords: invoice settings, numbering, number format, footer, defaults, payment terms, Revolut, QR bill, e-invoice address, instalments, dunning
Pages: /settings/invoices

1. Go to **Settings → Invoices**, or **Invoice settings** in the **Invoices** page menu.
2. Under **Payment methods**, turn on **Swiss QR bill** and/or **Revolut**. Under **Electronic invoicing**, add the e-invoice address your provider registered.
3. Under **Numbering**, pick one of the formats usual in your company's country (for example 2026-001 in Switzerland or INV-0001 in the US), or choose **Custom format** and build your own from text and placeholders: {YYYY} or {YY} (year), {MM} (month), {DD} (day), {TYPE} (INV, CN, DN, PF or Q) and {NNN} (the running number, zero-padded to three digits; {N} without padding). The running number is required. With a year in the format it restarts every year; without one it never restarts. After importing invoices into a new workspace, the welcome offers to keep numbering like them.
4. Set **Defaults** (currency, document language, payment terms), **Instalments**, **Dunning** and the **Footer**.
   Only owners and admins can change these. Numbers are given at issue, without gaps, and restart every year when the format has a year. There is one number sequence, and credit notes get their own numbers.

## Require approval before invoices are issued (approvals, approver groups)

Keywords: approval, approve, approver, four-eyes, Vier-Augen-Prinzip, sign-off, review before issuing, approval groups, needs my approval, reject
Pages: /settings/approvals

1. Go to **Settings → Approvals** (owners and admins, on the Business plan).
2. Under **Approver groups**, create groups such as Accountants or Management and add team members to them.
3. For each document type (invoices, credit notes, debit notes, corrections), turn on **Require approval before issuing**, optionally only from a minimum total, and add who must approve: at least a number of people from a group, or from anyone who can see invoices. Every rule must be met.
4. A draft then shows **Submit for approval** instead of **Issue**. Approvers are notified and find it under **Needs my approval** on the Invoices page, where they approve it or reject it with a reason. Once approved, the author (or anyone who can edit invoices) issues it.
   The author never approves their own document, one person counts once, and any change to the draft ends the request so it is submitted again. Every step is kept in the audit log.

## Change the email text for invoices and quotes (email templates)

Keywords: email template, email text, send by email, subject, message, wording, variables, invoice email, quote email, credit note email
Pages: /settings/emails

1. Go to **Settings → Emails**.
2. Pick the document type (**Invoice**, **Credit note**, **Proforma** or **Quote**) and the language (**DE**, **FR**, **IT** or **EN**). The client's document language decides which one is used.
3. Edit the **Subject** and **Message**. Click a variable such as **{client}** or **{number}** to insert it where your cursor is; it is replaced with the real value when you send.
4. Click **Save**. A dot on the language marks a customised template; **Reset to default** brings back the standard wording.
   The **Send by email** dialog opens with this text filled in, and you can still change it before sending. Only people who can edit invoice settings can change the templates.

## Close a month (month-end close, periods)

Keywords: close period, close month, month-end, lock books, periods, abschluss, reopen month, accounting period
Pages: /books, /settings/periods

1. Go to **Books → Closing**. Each month shows the invoices issued and expenses booked in it, and a warning when drafts are still dated in it.
2. Click **Close through …** at the top to close every open month up to the latest one that ended (the arrow beside it picks an earlier month), then confirm.
3. To make changes again, open the month's **…** menu, choose **Reopen**, and give a reason; it is kept in the audit log.
   While a month is closed, nothing dated in it can be issued, paid, voided or booked. Owners and admins can close or reopen months, and so can members with Edit on period closing.

## View the audit log

Keywords: audit log, audit trail, history, who changed, compliance, protokoll, financial events
Pages: /settings/audit-log

1. Go to **Settings → Audit log**. The tab is shown to owners, admins and members with View on the audit log.
2. Scroll through every financial event in order, with who did it. Click **Load more** for older entries.
3. A check at the top confirms the chain is intact, or shows where it broke.
   Entries can never be changed or removed.

## Prepare the Swiss VAT return (MWST, ESTV, eCH-0217)

Keywords: VAT return, MWST, mehrwertsteuer, ESTV, abrechnung, eCH-0217, tax return, net tax rate, saldosteuersatz
Pages: /books/vat-return, /settings/vat-return

1. Go to **Books → VAT return**.
2. In the VAT settings, set the method (**Effective method** or **Net tax rate method**), the period length and the basis (**Agreed** or **Received consideration**), then save. With net tax rates, add your **Approved net tax rates**.
3. Choose the **Period** and check the figures and any warnings.
4. Click **Export → ESTV file (XML)** to get the eCH-0217 file. The same menu has **PDF summary** and **CSV**.
5. In the ESTV ePortal, open MWST-Abrechnung pro → Import and upload the file.
   Figures come from issued invoices and booked expenses. Helvetly does not submit the return for you. Only owners and admins can change the VAT settings.

## See the ledger and export it for your accountant (Saldenliste, Hauptbuch, Treuhänder)

Keywords: ledger, saldenliste, hauptbuch, buchhaltung, trial balance, general ledger, kontenplan, chart of accounts, treuhänder, accountant, banana, bexio, abacus, journal export
Pages: /books/ledger, /settings/ledger

1. Go to **Books → Ledger**. The **Saldenliste** lists every account with **Opening**, **Debit**, **Credit** and **Closing**. Choose the **Year** and **Period**.
2. Click an account to see its **Hauptbuch**: every posting with the **Contra** account and a running **Balance**.
3. Click **Export** and choose **Banana**, **bexio**, **Abacus** or **CSV** to download the journal of the period for your Treuhänder. Banana takes only your base currency, so other currencies are skipped.
4. To change which account a posting uses, click **Accounts**, edit the codes (3 to 10 digits) and click **Save**. Only owners and admins can do this.
   The ledger is calculated from your invoices, payments and expenses, so changing an account also changes past periods: export closed periods first. Self-billed invoices and expenses without a category are listed as not in the ledger.

## Create or switch workspaces

Keywords: workspace, new workspace, switch company, add workspace, second company, mandant, firma wechseln

1. Click the workspace name at the top left of the sidebar.
2. To switch, pick another workspace from the list.
3. To create one, click **Add workspace**, enter a **Name** and confirm.
   Each workspace has its own members, data and plan.

## Rename a workspace or change its time zone

Keywords: rename workspace, workspace name, time zone, timezone, zeitzone
Pages: /settings/workspace

1. Go to **Settings → Workspace**.
2. Change the **Workspace name** and/or **Time zone**.
3. Click **Save**.
   Only an owner can rename the workspace. Owners and admins can change the time zone, which sets today's date, due dates and engagement periods. Issued invoices keep their dates.

## Delete a workspace

Keywords: delete workspace, remove workspace, close company, workspace löschen

1. Go to **Settings → Workspace**. This is for owners only.
2. Under **Delete workspace**, start the deletion.
3. Type the workspace name to confirm, then click **Delete workspace**.
   Everyone loses access and a paid plan ends at once. This can't be undone. Invoices and receipts stay archived for the ten years Swiss law requires.

## Invite a team member

Keywords: invite, member, team, add user, colleague, accountant, invitation, einladen, benutzer
Pages: /members, /invite

1. Go to **Members** and click **Invite member**.
2. Enter their **Email**.
3. Under **How to invite**, choose **By email** or **By link** (you share the link yourself).
4. Pick a **Role**: Owner, Admin or Member. For a Member, set their **Access**: Read only, Full access or Custom. Custom sets No access, View or Edit per area, with each settings page its own area: invoice settings, VAT return, ledger, period closing, audit log, workspace, billing and API & MCP. The audit log, workspace, billing, members and API & MCP stop at View; View of API & MCP lets them create and use personal tokens.
5. Click **Send invitation** or **Create link**. Open invitations are on the **Invited** tab, where you can resend or revoke them.
   Only owners and admins can invite. A link works for 7 days, and only for someone signed in with that email address.
   Plans are priced per person: on a per-person plan the invite dialog shows what the new member adds (for example "Adds CHF 49 / month incl. VAT"). The cost starts when the invitation is accepted, prorated for the rest of the billing period.

## Change a member's role or access, or remove them

Keywords: role, permissions, access, scopes, admin, change role, remove member, leave workspace, rechte
Pages: /members

1. Go to **Members** and open the row's **Actions** (…) menu.
2. Pick a new role: Owner, Admin or Member.
3. For a Member, choose **Change access…** and set each area to **No access**, **View** or **Edit**.
4. To take someone out, choose **Remove from workspace**. To leave yourself, choose **Leave workspace**.
   Managing members, settings and billing stays with owners and admins. The last owner can't leave.
   On a per-person plan, removing someone or leaving lowers the price from then on; the unused part of the period is credited on the next invoice.

## Choose or change a plan (billing, trial, limits)

Keywords: billing, plan, subscription, trial, upgrade, pricing, per person, per seat, per user, team size, abo, limit reached, read-only, cancel subscription, promotion code, invoice from helvetly
Pages: /settings/billing, /settings/billing/plans, /choose-plan, /activating

1. Go to **Settings → Billing** (Plan & billing) to see your plan, its status and usage against limits.
2. Under **Plans**, choose **Monthly** or **Yearly**, then pick **Basic**, **Pro** or **Business**; **Compare plans** shows every limit side by side. Prices include Swiss VAT. A new workspace can start a free Basic trial, and a card is required.
   Prices are per person per month (or year): Basic CHF 19, Pro CHF 49, Business CHF 99 a month, or CHF 183, 471 and 951 a year. Everyone in the workspace counts (owners, admins and members); open invitations don't count until accepted. The billing page shows the total, for example "CHF 49 × 3 people = CHF 147 / month incl. VAT". There is no limit on people on these plans.
   A workspace that subscribed before per-person pricing keeps its earlier flat price and its member limit until it changes plan or switches between monthly and yearly; from then on it pays per person.
3. To enter a discount, click **Have a promotion code?**.
4. To update your card, cancel or get invoices, click **Manage billing**. Past invoices are listed under **Invoices**.
   There is no free plan. Without an active plan the workspace is read-only: nothing is deleted, and it opens again once a plan is chosen. Only owners and admins can change the plan. When a limit is reached, you see a prompt with **See plans**.

## Update your profile

Keywords: profile, name, avatar, my account, account settings, personal settings
Pages: /account, /settings/security

1. Click your name at the bottom left and choose **Settings**, or go to **Settings → Account settings**.
2. Under **Profile**, change your **Full name** and click **Save**.
   Your email is your sign-in address. Your picture comes from Google if you connect it.

## Manage sign-in methods and passkeys

Keywords: sign in, login, passkey, google login, password, face id, touch id, email code, connect google
Pages: /account, /settings/security

1. Go to **Settings → Account settings → Sign-in methods**.
2. **Email code** sends a 6-digit code to your email. There are no passwords.
3. Connect **Google** for one-click sign-in, or click **Disconnect** to remove it.
4. Under **Passkeys**, click **Add passkey** to sign in with your fingerprint, face or device PIN. Remove a passkey with its remove icon.

## Turn on two-factor authentication (2FA) in your account

Keywords: 2FA, two-factor, authenticator, TOTP, security, recovery codes, zwei-faktor
Pages: /account, /settings/security

1. Go to **Settings → Account settings → Two-factor authentication** and click **Turn on**.
2. Scan the code with an authenticator app such as 1Password, Google Authenticator or Authy.
3. Type the 6-digit **Code from the app** and click **Turn on**.
4. Save your recovery codes. Each one signs you in once if you lose your phone.
   To turn it off, click **Turn off** and enter a code from the app or a recovery code. Recovery codes are shown only once.

## See and end active sessions

Keywords: sessions, devices, sign out everywhere, logged in devices, log out other devices, security
Pages: /account, /settings/security

1. Go to **Settings → Account settings → Active sessions**.
2. Check the browsers and devices signed in to your account.
3. Sign out one session, or click **Sign out of all other sessions**.
   To sign out of the current browser, click your name at the bottom left → **Log out**.

## Connect Claude or your own scripts (API tokens, MCP, API)

Keywords: api, api token, access token, personal access token, mcp, claude, chatgpt, integration, automation, openapi, developer, zapier, script
Pages: /settings/api, /developers

1. Go to **Settings → API & MCP** and click **Create token**.
2. Give it a name, choose its access (**Read everything**, **Full access**, or **Custom** to tick Read and Write per area such as Clients or Invoices) and an expiry. The panel shows what the token can do before you create it.
3. Copy the token right away. It is shown only once.
4. Use it as `Authorization: Bearer <token>`: with the API (see **API reference**, where **Try in Playground** on each operation sends a real request with a token you paste), or in an AI tool: **Connect an AI assistant** on the same page has ready-to-paste setups for Claude Code, Claude Desktop and Cursor.
   A token acts as you, with your permissions, in the workspace where you created it. Revoke it with its revoke icon when you no longer need it.

What a token can do: read and change clients and contacts, invoices (drafts, issue, send, PDF, e-invoice XML, payments, refunds, void, credit notes, reminders), quotes, instalment plans, expenses and receipts, documents and folders, engagements and their delivery log, products and services, and the books (periods, audit log, VAT return, ledger). It can never manage members, invitations, billing, API tokens, your account or the workspace itself, and it cannot use Heidi.

## Delete your account

Keywords: delete account, close account, remove me, konto löschen, gdpr delete

1. Go to **Settings → Account settings → Delete account**.
2. Type your email to confirm and click **Delete account**.
   You leave every workspace and are signed out everywhere. This can't be undone. Transfer ownership, or delete workspaces where you are the last owner, first.

## Manage notifications

Keywords: notifications, bell, email notifications, alerts, unread, mark as read, digest
Pages: /notifications, /account/notifications

1. Click **Notifications** in the sidebar to open the bell with the latest items, or click **All notifications** to see the full page.
2. On the Notifications page, click **Mark all as read**.
3. To choose what reaches you by email and in the bell, go to **Settings → Account settings → Notifications**, tick per event and click **Save changes**.
   Owners and admins can turn on a **Daily e-mail digest** for engagements in the **Engagements** page menu.

## Export your data

Keywords: export, backup, download data, data export, zip, json, csv, gdpr, datenexport

1. To export a whole workspace (owners only), go to **Settings → Workspace → Export all data** and click **Download export**. You get a ZIP with every record as JSON plus the stored files.
2. To export your personal data, go to **Settings → Account settings → Your data** and click **Download my data** (JSON).
3. For lists, use **Export CSV** in the page menu or on selected rows of Clients, Invoices, Products & services and Expenses.
   The workspace export includes deleted and voided records. Large workspaces take a while.

## Use Heidi, the assistant

Keywords: heidi, assistant, ai, chat, ask, chatbot, openai, consent, allow ai, token budget, ai allowance, what can heidi do

1. Press ⌘J (Ctrl+J) or click **Ask Heidi** in the sidebar. Type a question, or pick one under **Try asking**.
2. Heidi can show overdue and recent invoices, this month's expenses and input VAT, recent clients and documents, and engagement balances. She can open invoices and engagements, start a new invoice and log work on an engagement.
3. To attach images or PDFs, use **Attach files** or drop them on the panel. Up to 4 files per message, 8 MB each.
4. Before Heidi logs work or sends an invoice, she asks you to confirm. Use **New chat**, **Search in conversation** or **Max view** in the panel header.
5. For full AI answers, an owner or admin clicks **Allow OpenAI** in the panel, or turns on **AI answers with OpenAI** in **Settings → Workspace**. Until then, Heidi answers from your records and this guide only.
   Heidi can make mistakes, so check figures against the source. She can't issue invoices, book expenses or change settings on her own. The footer shows how much of this month's AI budget is used; the budget is shared with AI import.

## Get help or send feedback

Keywords: help, feedback, support, report bug, problem, feature request, suggestion, contact support, screenshot

1. Click **Help & feedback** at the bottom of the sidebar, or choose it in your name menu or in Quick Actions.
2. For a how-to question, click **Ask Heidi** at the top: Heidi's panel opens.
3. To tell the team something, choose **Report a problem** or **Suggest an idea**.
4. Write a **Description**. Optionally add **Screenshots** (drop, paste or browse): up to 5 PNG, JPEG or WebP images, 5 MB each.
5. Click **Send feedback**.
   Your account, workspace and the page you are on are included, but your screen is not recorded. Remove any private information from screenshots first.

## Read the dashboard

Keywords: dashboard, home, overview, key figures, cash flow, needs attention, start page
Pages: /

1. The **Dashboard** is the first page after sign-in: **Home** in the sidebar.
2. **Key figures** sum up the period you pick (30D, 90D or 12M).
3. **Cash flow** shows income (invoice payments and refunds) against paid expenses, in the currency you choose.
4. **Needs attention** lists open invoices; click **All that needs attention** for the rest. **New invoice** starts one.
   You only see the sections your access lets you read.

## Set up your workspace (welcome)

Keywords: welcome, onboarding, get started, first steps, setup, first invoice
Pages: /welcome

1. A new workspace starts on the welcome page: five steps for your company details and your first invoice.
2. What you fill in on the left appears in the **Invoice preview** on the right, down to the QR bill, exactly as clients will see it.
3. Pick the interface language at the top. You can change everything later in **Settings**.

## Keep employee records

Keywords: employees, staff, employee, personnel, mitarbeiter, pracownicy, department, pay terms, hr
Pages: /employees

1. Go to **Employees** and click **New employee**. Fill in their details, place of work and pay terms.
2. Filter the list by department; open an employee to edit them or **Add a document** (contracts, certificates).
3. **Export employee data** downloads the records.
   Employees are your company's staff, not members: adding one gives no access to Helvetly, sends no invitation and adds no paid seat. Employees and payroll come with the Business plan; only people with Employees access see them.

## Record payroll (payroll register)

Keywords: payroll, salary, lohn, wages, payslip, payroll register, lohnbuchhaltung, net pay, approve payroll
Pages: /employees/payroll

1. Go to **Employees → Payroll** and pick the month. Click **New entry** for an employee, or **Import** a payroll CSV.
2. Enter the figures you or your payroll provider computed. Helvetly records pay; it does not calculate pay, taxes or contributions.
3. **Approve** confirms an entry, **Mark as paid** records the payment. Approved entries become journal lines for your books.
4. To change an approved entry, click **Correct**: the correction replaces it and keeps the original. **Export CSV** downloads the month.
   Only people with Payroll access see this page; payroll edit access is needed to enter or approve.

## Set up employment (employer and payroll approval)

Keywords: employment, employer, employing company, payroll approval, second approver, employment profile
Pages: /settings/employment

1. Go to **Settings → Employment**.
2. The **Company employment profile** pre-fills the employing company and country of work for new employees. Each employee keeps their own place of work.
3. Turn on **Require a second person to approve payroll** so whoever entered an entry cannot approve it.
   Only people with Employees and Payroll edit access can change this.
