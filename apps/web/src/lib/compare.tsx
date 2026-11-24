import type { ReactNode } from 'react'

import { perLanguage } from '@/lib/i18n'
import { type Plan, type PlanId, plansIn, SELF_SERVICE_SEATS, totalOf } from '@/lib/plans'
import type { Tone } from '@/lib/tones'

// Side-by-side comparisons with other business software used in Switzerland. What each competitor offers comes from its
// own public website on the date in `checked`, its prices on the date in `pricesChecked`. Comparative advertising must be accurate and verifiable
// (UWG art. 3 para. 1 lit. e): re-check a competitor's rows against its site before changing them.
// Re-check in a browser before each release: KLARA's prices (its pages disagree), KLARA's reminders and
// roles (help pages refused automated reads) and bexio's help-centre claims. For the international tools (read
// 19 November 2026): Xero's help centre (central.xero.com, an empty page to automated reads: deposits, roles,
// lock dates, export, notifications), Bonsai's help centre (help.hellobonsai.com, 403: sign-in, export, partial
// payments), Zoho's mobile apps page (403), QuickBooks' promo fine print and its global prices (loaded live) and
// which Zoho plans include Zia. Zoho's prices for Switzerland are the EUR group of its pricing page's own table.

/** true: offered; false: not offered; null: not found on their site; text: how it is offered. */
export type Cell = string | boolean | null

export type RowKey =
  | 'madeFor'
  | 'price'
  | 'yearlyCost'
  | 'pricingModel'
  | 'teamRoles'
  | 'qrBill'
  | 'documentTypes'
  | 'invoiceLanguages'
  | 'reminders'
  | 'depositPartial'
  | 'instalments'
  | 'einvoices'
  | 'vatReturn'
  | 'expenses'
  | 'signatures'
  | 'contractTemplates'
  | 'clientPortal'
  | 'retainers'
  | 'auditLog'
  | 'assistant'
  | 'aiImport'
  | 'signIn'
  | 'dataExport'
  | 'notifications'
  | 'apps'

/** The rows where Helvetly's cell quotes plans.ts prices, shown only while the API's offer confirms them. */
export const PRICE_ROWS: ReadonlySet<RowKey> = new Set(['price', 'yearlyCost'])

export type Competitor = {
  slug: string
  name: string
  url: string
  /** Their icon, taken from their own website, under `public/brands`. */
  logo: string
  /** The card colour on the comparisons page. */
  tone: Tone
  /** One line on what they are, for the comparisons page. */
  summary: string
  /** The day their public site was last read for this page. */
  checked: string
  /** The day their prices and packages were last read. */
  pricesChecked: string
  title: ReactNode
  lead: string
  /** Completes "Helvetly is the better fit when you…". */
  oursIf: string[]
  /** Completes "<name> may suit you better if you…". */
  theirsIf: string[]
  rows: Record<RowKey, Cell>
}

const year = (p: Plan, people: number) => totalOf(p, 'year', people).amount / 100

/** The comparisons with other Swiss business software, in one language. */
export const compareIn = perLanguage((translate, language) => {
  const { count, LIMITS, planById, plansWith } = plansIn(language)

  const ROW_GROUPS: { group: string; rows: { key: RowKey; label: string }[] }[] = [
    {
      group: translate('whoItIsFor'),
      rows: [
        { key: 'madeFor', label: translate('madeFor') },
        { key: 'price', label: translate('packagesAndPrice') },
        { key: 'yearlyCost', label: translate('aYearFor1AndFor3People') },
        { key: 'pricingModel', label: translate('pricingModel') },
        { key: 'teamRoles', label: translate('teamAndRoles') },
      ],
    },
    {
      group: translate('gettingPaid2'),
      rows: [
        { key: 'qrBill', label: translate('swissQRBill') },
        { key: 'documentTypes', label: translate('documentTypes') },
        { key: 'invoiceLanguages', label: translate('invoiceLanguages') },
        { key: 'reminders', label: translate('automaticReminders') },
        { key: 'depositPartial', label: translate('depositAndPartialInvoices') },
        { key: 'instalments', label: translate('instalmentSchedulesWithAQRBillEach') },
        { key: 'einvoices', label: translate('eInvoices') },
      ],
    },
    {
      group: translate('backOffice2'),
      rows: [
        { key: 'vatReturn', label: translate('vatReturn') },
        { key: 'expenses', label: translate('expensesWithReceipts') },
        { key: 'signatures', label: translate('electronicSignatures') },
        { key: 'contractTemplates', label: translate('contractTemplatesFilledWithClientData') },
        { key: 'clientPortal', label: translate('clientPortal') },
        { key: 'retainers', label: translate('retainersWithHourTracking') },
        { key: 'auditLog', label: translate('closedPeriodsAndAuditLog') },
      ],
    },
    {
      group: translate('ai'),
      rows: [
        { key: 'assistant', label: translate('assistantOverYourOwnRecords') },
        { key: 'aiImport', label: translate('importFromYourFilesWithAI') },
      ],
    },
    {
      group: translate('securityDataAndApps'),
      rows: [
        { key: 'signIn', label: translate('signIn2') },
        { key: 'dataExport', label: translate('exportOfAllYourData') },
        { key: 'notifications', label: translate('notificationsPerPerson') },
        { key: 'apps', label: translate('apps') },
      ],
    },
  ]

  const yearly = (id: PlanId) => {
    const p = planById(id)
    return translate('chf', { name: p.name, value2: count(year(p, 1)), value3: count(year(p, 3)) })
  }
  const monthly = (id: PlanId) => {
    const p = planById(id)
    return translate('planMonthlyWithPeopleIncluded', {
      name: p.name,
      amount: count(p.monthly),
      people: p.includedPeople,
      extra: count(p.extraMonthly),
    })
  }

  /** Helvetly's side of every comparison. */
  const OURS: Record<RowKey, Cell> = {
    madeFor: translate('swissCompaniesOfAnySizeAloneOrAsA'),
    price: translate('freeForOnePersonThenPlansInclVAT', {
      free: planById('free').name,
      value1: monthly('basic'),
      value2: monthly('pro'),
      value3: monthly('business'),
    }),
    yearlyCost: translate('inclVAT2', {
      value1: yearly('pro'),
      value2: yearly('basic'),
      value3: yearly('business'),
    }),
    pricingModel: translate('aFreePlanThenThreePlansWithPeopleIncluded'),
    teamRoles: translate('ownerAdminsAndMembersUpToPeoplePerPlan', {
      basic: SELF_SERVICE_SEATS.basic,
      pro: SELF_SERVICE_SEATS.pro,
    }),
    documentTypes: translate('invoicePartialPrepaymentProformaAndSelfBilledCreditNote', {
      value1: plansWith('corrections_vat'),
    }),
    contractTemplates: translate('with', { value1: plansWith('templates_signatures') }),
    assistant: translate('heidiWithAnswersFromYourRecordsAndActsOnly', {
      value1: plansWith('heidi'),
    }),
    aiImport: translate('pdfsImagesCSVExcelWordAndZIPFilesReviewed2'),
    signIn: translate('passkeysEmailedCodesOrGoogleWithTOTPTwoFactor'),
    dataExport: translate('singleDocumentsInEveryPlanBusinessDataTheWhole', {
      value1: plansWith('ledger_exports'),
    }),
    notifications: translate('eachPersonChoosesInTheAppAndByEmail'),
    qrBill: true,
    invoiceLanguages: translate('germanFrenchItalianEnglish'),
    reminders: translate('upTo10StepsWithFeesAndOR1042', { value1: plansWith('automations') }),
    depositPartial: true,
    instalments: translate('with', { value1: plansWith('automations') }),
    einvoices: translate('xrechnungPeppolBISKSeFAndEFacturaXMLFiles', {
      value1: plansWith('einvoice_xml'),
    }),
    expenses: translate('includedInEveryPlan'),
    vatReturn: translate('withEffectiveAndNetTaxRateAsTheECH', {
      value1: plansWith('corrections_vat'),
    }),
    signatures: translate('simpleElectronicSignaturesWithNoQualifiedSignatures', {
      value1: plansWith('templates_signatures'),
    }),
    clientPortal: translate('in', { value1: plansWith('client_portal') }),
    retainers: translate('yesUpToActiveInBasicManagedByHand', {
      basic: LIMITS.engagements.values.basic,
    }),
    auditLog: translate('closedMonthsAndATamperEvidentHashChainedLog'),
    apps: translate('webAppForEveryDevice'),
  }

  const internationalTitle = (
    <>
      {translate('cmpMadeFor')}
      <span className="accent">{translate('cmpSwiss')}</span>
      {translate('cmpInvoicesAndVAT')}
    </>
  )

  const COMPETITORS: Competitor[] = [
    {
      slug: 'magic-heidi',
      name: translate('magicHeidi'),
      url: 'https://magicheidi.ch',
      logo: '/brands/magic-heidi.png',
      tone: 'rose',
      summary: translate('aSimpleInvoicingAndBookkeepingAppForTheSwiss'),
      checked: translate('message11November2026'),
      pricesChecked: translate('message15November2026'),
      title: (
        <>
          {translate('grownPastThe')}
          <span className="accent">{translate('milchbEchli')}</span>
        </>
      ),
      lead: translate('magicHeidiIsAFineAppForTheSelf2'),
      oursIf: [
        translate('needXRechnungPeppolBISKSeFOrEFacturaXML'),
        translate('sendContractsForSimpleSignatureFromTemplatesProAnd'),
        translate('shareInvoicesAndDocumentsWithClientsInAPortal'),
        translate('billRetainersAndNeedToSeeTheHoursLeft'),
        translate('wantAnAssistantBuiltInWithNoAIAccount'),
      ],
      theirsIf: [
        translate('wantOnePriceHoweverManyPeopleWorkInIt'),
        translate('needNativePhoneAndDesktopApps'),
        translate('wantYourBankFeedMatchedToInvoicesAutomatically'),
        translate('sellThroughShopifyAmazonOrEtsy'),
      ],
      rows: {
        madeFor: translate('swissSelfEmployedPeopleAndSoleProprietorships'),
        price: translate('freeFor3InvoicesAnd3ReceiptsProCHF'),
        yearlyCost: translate('proCHF299299InclVAT'),
        pricingModel: translate('aFreePlanThenOneProPlanWithNo'),
        teamRoles: translate('teamAndFiduciaryAccess'),
        documentTypes: translate('invoiceDepositAndPartialCreditNoteCancellationWithA'),
        contractTemplates: null,
        assistant: translate('connectsYourOwnClaudeOrChatGPTThroughMCPAn'),
        aiImport: translate('excelCSVOrPDFWithAIColumnMapping'),
        signIn: translate('googleAppleOrAnEmailedCodeWithOptionalTwo'),
        dataExport: translate('everythingAsAZIPAnyTime'),
        notifications: null,
        qrBill: true,
        invoiceLanguages: translate('germanFrenchItalianEnglish'),
        reminders: true,
        depositPartial: true,
        instalments: false,
        einvoices: false,
        expenses: true,
        vatReturn: translate('yesWithAnESTVExport'),
        signatures: false,
        clientPortal: false,
        retainers: false,
        auditLog: false,
        apps: translate('nativeAppsForIPhoneAndroidMacAndWindowsAnd'),
      },
    },
    {
      slug: 'bexio',
      name: translate('bexio'),
      url: 'https://www.bexio.com',
      logo: '/brands/bexio.svg',
      tone: 'sky',
      summary: translate('aBroadSwissBusinessSuiteWithAccountingPayrollAnd'),
      checked: translate('message11November2026'),
      pricesChecked: translate('message15November2026'),
      title: (
        <>
          {translate('builtToGetYouPaid')}
          <span className="accent">{translate('not')}</span>
          {translate('toRunAnERP')}
        </>
      ),
      lead: translate('bexioIsABroadSwissBusinessSuiteWithAccounting'),
      oursIf: [
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
        translate('billRetainersAndNeedToSeeTheHoursLeft'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
        translate('wantToStartFreeAndAddPeopleOneAtATime'),
      ],
      theirsIf: [
        translate('needFullBookkeepingAndAnnualFinancialStatementsInThe'),
        translate('runSwissdecCertifiedPayrollForEmployees'),
        translate('needStockManagementAlongsideInvoicing'),
        translate('workWithAFiduciaryWhoAlreadyUsesBexio'),
      ],
      rows: {
        madeFor: translate('swissSmallBusinessesStartupsTheSelfEmployedAndTheir'),
        price: translate('basicCHF35AdvancedCHF42OptimaCHF69'),
        yearlyCost: translate('advancedCHF504For12UsersOptimaCHF'),
        pricingModel: translate('fourTiersByFeaturesAndIncludedUsersPlusAdd'),
        teamRoles: translate('usersPerPlanWithPermissionsFreeFiduciaryAccess'),
        documentTypes: translate('invoiceCreditNoteAndPartialInvoicesFromAnOrder'),
        contractTemplates: null,
        assistant: null,
        aiImport: translate('aiReadsReceiptsAndQRInvoicesAdvancedAndUp'),
        signIn: translate('passwordAndAnEmailedCodeOptionalAuthenticatorApp'),
        dataExport: translate('perModuleAsExcelOrPDF'),
        notifications: null,
        qrBill: true,
        invoiceLanguages: translate('multilingualTemplatesLanguagePerDocument'),
        reminders: translate('automaticWithConfigurableLevels'),
        depositPartial: true,
        instalments: null,
        einvoices: translate('ebillThroughAnIntegration'),
        expenses: translate('fromTheAdvancedPlan'),
        vatReturn: translate('effectiveAndNetTaxRateFiguresTransferredToThe'),
        signatures: null,
        clientPortal: null,
        retainers: null,
        auditLog: translate('fiscalYearsCanBeLocked'),
        apps: translate('webAppBexioGoForIOSAndAndroid'),
      },
    },
    {
      slug: 'klara',
      name: 'KLARA',
      url: 'https://www.klara.ch',
      logo: '/brands/klara.png',
      tone: 'peach',
      summary: translate('aModularSMESuiteWithAccountingPayrollPOSAnd'),
      checked: translate('message11November2026'),
      pricesChecked: translate('message15November2026'),
      title: (
        <>
          {translate('everythingToGetPaid')}
          <span className="accent">{translate('without')}</span>
          {translate('theModules')}
        </>
      ),
      lead: translate('klaraBundlesAccountingPayrollATillAndAnOnline2'),
      oursIf: [
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
        translate('billRetainersAndNeedToSeeTheHoursLeft'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
        translate('preferFourClearPlansToPackagesAndPerUseAddOns'),
      ],
      theirsIf: [
        translate('wantAccountingPayrollAndInvoicingFromOneSwissVendor'),
        translate('runAShopOrVenueAndNeedATill'),
        translate('sendInvoicesByEBillEPostOrSwissPostPrint'),
        translate('wantAnOnlineShopAndBookingFromTheSame'),
      ],
      rows: {
        madeFor: translate('swissSMEsAccountingCRMOrdersPayrollAndPOSIn'),
        price: translate('businessBasicCHF69MonthCHF55YearlyCHF'),
        yearlyCost: translate('businessBasicCHF660660OnAYearlyPlan'),
        pricingModel: translate('packagesPlusPaidModulesSuchAsBudgetEArchiveInventory'),
        teamRoles: translate('rolesForAdminsTrusteesPayrollAccountingAndMore'),
        documentTypes: translate('invoiceCreditNoteCollectiveAndRecurringInvoices'),
        contractTemplates: null,
        assistant: translate('connectsAnOutsideChatGPTOrClaude'),
        aiImport: translate('aiReceiptScanning'),
        signIn: translate('passwordOptionalAuthenticatorApp'),
        dataExport: translate('perAreaSuchAsCustomersOrReports'),
        notifications: null,
        qrBill: true,
        invoiceLanguages: null,
        reminders: translate('threeLevelsSentAfterConfirmation'),
        depositPartial: true,
        instalments: null,
        einvoices: translate('ebillAndEPost'),
        expenses: true,
        vatReturn: translate('effectiveAndNetTaxRateWithAnXMLFile'),
        signatures: null,
        clientPortal: null,
        retainers: null,
        auditLog: null,
        apps: translate('webAppMyKLARAForIOSAndAndroidAPOS'),
      },
    },
    {
      slug: 'banana',
      name: translate('banana'),
      url: 'https://www.banana.ch',
      logo: '/brands/banana.png',
      tone: 'lemon',
      summary: translate('lowCostDesktopAccountingSoftwareForPeopleWhoKeep'),
      checked: translate('message11November2026'),
      pricesChecked: translate('message15November2026'),
      title: (
        <>
          {translate('fromDesktopFilesToA')}
          <span className="accent">{translate('shared')}</span>
          {translate('backOffice3')}
        </>
      ),
      lead: translate('bananaAccountingIsLowCostDesktopSoftwareForPeople'),
      oursIf: [
        translate('workInTheSameRecordsAsATeamAt'),
        translate('wantRemindersSentAutomaticallyWithFeesAndInterest'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('wantAnAssistantWhoAnswersFromYourRecords'),
      ],
      theirsIf: [
        translate('wantDesktopSoftwareThatKeepsYourFilesOnYour'),
        translate('needDoubleEntryBookkeepingAtALowYearlyPrice'),
        translate('keepManyClientsBooksAsAnAccountantOnOne'),
        translate('wantAFreePlanForVerySmallBooks'),
      ],
      rows: {
        madeFor: translate('smallCompaniesAssociationsPrivatePeopleAndAccountants'),
        price: translate('freeUpTo70TransactionsProfessionalCHF89Year2'),
        yearlyCost: translate('advancedWithTheVATXMLCHF179537VAT'),
        pricingModel: translate('yearlyLicencePerUserForUpTo5Devices'),
        teamRoles: translate('multiUserSubscriptionsOnePersonEditsAFileAt'),
        documentTypes: translate('invoiceAndCreditNoteProformaInAdvanced'),
        contractTemplates: null,
        assistant: translate('chatgptHelpersOutsideTheAppChatGPTPlus'),
        aiImport: null,
        signIn: translate('localFilesWithAnOptionalFilePassword'),
        dataExport: translate('yourFilesStayOnYourOwnComputer'),
        notifications: null,
        qrBill: true,
        invoiceLanguages: translate('germanFrenchItalianEnglish'),
        reminders: translate('printedByHandUpToThreeLevels'),
        depositPartial: null,
        instalments: null,
        einvoices: null,
        expenses: translate('entriesLinkedToPDFReceipts'),
        vatReturn: translate('effectiveAndNetTaxRateWithAnXMLFile2'),
        signatures: null,
        clientPortal: null,
        retainers: null,
        auditLog: translate('lockedEntriesWithHashChainedControlCodes'),
        apps: translate('windowsMacAndLinuxIOSAndroidAndAWeb'),
      },
    },
    {
      slug: 'cashctrl',
      name: translate('cashctrl'),
      url: 'https://cashctrl.com',
      logo: '/brands/cashctrl.png',
      tone: 'mint',
      summary: translate('onlineDoubleEntryAccountingForPeopleWhoKeepTheir'),
      checked: translate('message11November2026'),
      pricesChecked: translate('message15November2026'),
      title: (
        <>
          {translate('lessBookkeeping')}
          <span className="accent">{translate('more')}</span>
          {translate('gettingPaid')}
        </>
      ),
      lead: translate('cashctrlIsACapableOnlineDoubleEntryAccountingPackage'),
      oursIf: [
        translate('wantRemindersSentAutomaticallyWithFeesAndInterest'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('wantToWorkOnYourPhoneAsWellAs'),
        translate('wantAnAssistantWhoAnswersFromYourRecords'),
      ],
      theirsIf: [
        translate('wantFullDoubleEntryBookkeepingWithYearEndClosing'),
        translate('runPayrollForAFewEmployeesAlongsideTheBooks'),
        translate('manageSeveralClientCompaniesAsAFiduciary'),
      ],
      rows: {
        madeFor: translate('smesFreelancersAndFiduciariesWhoKnowDoubleEntryBookkeeping'),
        price: translate('freeFor1UserPROCHF350YearWith2'),
        yearlyCost: translate('proCHF350350InclVAT'),
        pricingModel: translate('freePlanThenPrepaidLicences612Or24'),
        teamRoles: translate('rolesForAdminsGuestsAndTrusteesAndCustomOnes'),
        documentTypes: translate('invoiceAndCreditNoteOffersAndMoreInPRO'),
        contractTemplates: translate('lettersFromTextTemplates'),
        assistant: null,
        aiImport: null,
        signIn: translate('passwordPasskeysAndTwoFactor'),
        dataExport: translate('perModuleDocumentsAsZIP'),
        notifications: null,
        qrBill: true,
        invoiceLanguages: translate('germanFrenchItalianEnglish'),
        reminders: translate('reminderDocumentsCreatedByHand'),
        depositPartial: null,
        instalments: null,
        einvoices: null,
        expenses: translate('asPurchaseInvoices'),
        vatReturn: translate('effectiveAndNetTaxRateWithAnXMLFile'),
        signatures: null,
        clientPortal: null,
        retainers: null,
        auditLog: true,
        apps: translate('webAppForComputersPhoneBrowsersNotSupported'),
      },
    },
    {
      slug: 'abaninja',
      name: translate('abaninja'),
      url: 'https://abaninja.ch',
      logo: '/brands/abaninja.png',
      tone: 'lilac',
      summary: translate('invoicingAccountingAndPayrollFromTheAbacusWorldWith'),
      checked: translate('message11November2026'),
      pricesChecked: translate('message15November2026'),
      title: (
        <>
          {translate('yourBackOffice')}
          <span className="accent">{translate('beyond')}</span>
          {translate('switzerland')}
        </>
      ),
      lead: translate('abaninjaPacksInvoicingAccountingAndPayrollFromTheAbacus'),
      oursIf: [
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('billRetainersAndNeedToSeeTheHoursLeft'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('needATamperEvidentAuditLogOfEveryFinancial'),
        translate('preferMonthlyAllowancesToTiersLimitedByDocumentsAYear'),
      ],
      theirsIf: [
        translate('wantAFreePlanThatIncludesAccountingAndPayroll'),
        translate('needPayrollWithELMAndSalaryCertificatesInThe'),
        translate('wantInventoryAShopOrATillInOne'),
        translate('expectToMoveToAbacusERPLater'),
      ],
      rows: {
        madeFor: translate('swissSMEsStartupsFreelancersAssociationsAndAccountants'),
        price: translate('starterFree1User1000DocumentsAYear'),
        yearlyCost: translate('basicCHF252252AtTheMonthlyPriceVAT'),
        pricingModel: translate('freePlanThenTiersLimitedByUsersPayrollRuns'),
        teamRoles: translate('userGroupsWithPermissionsPerArea'),
        documentTypes: translate('invoiceAdvancePartialInstalmentAndCreditNote'),
        contractTemplates: null,
        assistant: translate('samuraiActsAfterConfirmation'),
        aiImport: translate('aiReadsPDFInvoicesAndReceipts'),
        signIn: translate('passwordGoogleAppleOrMicrosoftOptionalTwoFactor'),
        dataExport: translate('perApplicationNoFullDatabaseExport'),
        notifications: translate('emailEventsChosenPerUser'),
        qrBill: true,
        invoiceLanguages: translate('germanFrenchItalianEnglish'),
        reminders: translate('upToThreeLevelsSentAutomaticallyOrByHand'),
        depositPartial: true,
        instalments: translate('instalmentInvoicesFromAnOrder'),
        einvoices: translate('ebillThroughAbaNet21AMonthInBasicThen'),
        expenses: true,
        vatReturn: translate('effectiveAndNetTaxRateAsAGuideFor'),
        signatures: translate('offerSigningWithDeepSignPaid'),
        clientPortal: true,
        retainers: null,
        auditLog: null,
        apps: translate('webAppAbaClikForIOSAndAndroid'),
      },
    },
    {
      slug: 'quickbooks',
      name: 'QuickBooks Online',
      url: 'https://quickbooks.intuit.com',
      logo: '/brands/quickbooks.png',
      tone: 'mint',
      summary: translate('qbSummary'),
      checked: translate('message19November2026'),
      pricesChecked: translate('message19November2026'),
      title: internationalTitle,
      lead: `${translate('qbLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpInvoiceInGermanFrenchItalian'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
      ],
      theirsIf: [
        translate('cmpWantBankFeeds'),
        translate('cmpWorkWithAccountantWhoUses', { name: 'QuickBooks' }),
        translate('qbNeedInventory'),
        translate('needNativePhoneAndDesktopApps'),
      ],
      rows: {
        madeFor: translate('qbMadeFor'),
        price: translate('qbPrice'),
        yearlyCost: translate('qbYearly'),
        pricingModel: translate('qbPricingModel'),
        teamRoles: translate('qbTeamRoles'),
        documentTypes: translate('qbDocumentTypes'),
        contractTemplates: null,
        assistant: translate('qbAssistant'),
        aiImport: translate('qbAiImport'),
        signIn: translate('qbSignIn'),
        dataExport: translate('qbDataExport'),
        notifications: null,
        qrBill: null,
        invoiceLanguages: translate('qbInvoiceLanguages'),
        reminders: true,
        depositPartial: true,
        instalments: null,
        einvoices: translate('qbEinvoices'),
        expenses: true,
        vatReturn: translate('cmpVATByCountryNoSwiss'),
        signatures: translate('qbSignatures'),
        clientPortal: null,
        retainers: translate('qbRetainers'),
        auditLog: translate('qbAuditLog'),
        apps: translate('qbApps'),
      },
    },
    {
      slug: 'xero',
      name: 'Xero',
      url: 'https://www.xero.com',
      logo: '/brands/xero.svg',
      tone: 'sky',
      summary: translate('xeroSummary'),
      checked: translate('message19November2026'),
      pricesChecked: translate('message19November2026'),
      title: internationalTitle,
      lead: `${translate('xeroLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpWantPricesInCHF'),
        translate('cmpInvoiceInGermanFrenchItalian'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
      ],
      theirsIf: [
        translate('cmpWorkWithAccountantWhoUses', { name: 'Xero' }),
        translate('cmpWantBankFeeds'),
        translate('xeroManyApps'),
        translate('xeroUKPayroll'),
      ],
      rows: {
        madeFor: translate('xeroMadeFor'),
        price: translate('xeroPrice'),
        yearlyCost: translate('xeroYearly'),
        pricingModel: translate('xeroPricingModel'),
        teamRoles: translate('xeroTeamRoles'),
        documentTypes: translate('xeroDocumentTypes'),
        contractTemplates: null,
        assistant: translate('xeroAssistant'),
        aiImport: translate('xeroAiImport'),
        signIn: translate('xeroSignIn'),
        dataExport: null,
        notifications: null,
        qrBill: translate('xeroQRBill'),
        invoiceLanguages: null,
        reminders: true,
        depositPartial: null,
        instalments: null,
        einvoices: translate('xeroEinvoices'),
        expenses: true,
        vatReturn: translate('cmpVATByCountryNoSwiss'),
        signatures: null,
        clientPortal: null,
        retainers: null,
        auditLog: null,
        apps: translate('cmpWebIOSAndroid'),
      },
    },
    {
      slug: 'freshbooks',
      name: 'FreshBooks',
      url: 'https://www.freshbooks.com',
      logo: '/brands/freshbooks.svg',
      tone: 'peach',
      summary: translate('fbSummary'),
      checked: translate('message19November2026'),
      pricesChecked: translate('message19November2026'),
      title: internationalTitle,
      lead: `${translate('fbLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpWantPricesInCHF'),
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('wantAnAssistantBuiltInWithNoAIAccount'),
      ],
      theirsIf: [
        translate('fbTrackTime'),
        translate('fbProposals'),
        translate('fbManyLanguages'),
        translate('cmpWantNativePhoneApps'),
      ],
      rows: {
        madeFor: translate('fbMadeFor'),
        price: translate('fbPrice'),
        yearlyCost: translate('fbYearly'),
        pricingModel: translate('fbPricingModel'),
        teamRoles: translate('fbTeamRoles'),
        documentTypes: translate('fbDocumentTypes'),
        contractTemplates: null,
        assistant: translate('fbAssistant'),
        aiImport: translate('fbAiImport'),
        signIn: translate('fbSignIn'),
        dataExport: translate('fbDataExport'),
        notifications: translate('fbNotifications'),
        qrBill: null,
        invoiceLanguages: translate('fbInvoiceLanguages'),
        reminders: true,
        depositPartial: true,
        instalments: translate('fbInstalments'),
        einvoices: null,
        expenses: translate('fbExpenses'),
        vatReturn: translate('cmpVATByCountryNoSwiss'),
        signatures: translate('fbSignatures'),
        clientPortal: true,
        retainers: translate('fbRetainers'),
        auditLog: translate('fbAuditLog'),
        apps: translate('cmpWebIOSAndroid'),
      },
    },
    {
      slug: 'zoho-books',
      name: 'Zoho Books',
      url: 'https://www.zoho.com/books/',
      logo: '/brands/zoho-books.png',
      tone: 'lemon',
      summary: translate('zbSummary'),
      checked: translate('message19November2026'),
      pricesChecked: translate('message19November2026'),
      title: internationalTitle,
      lead: `${translate('zbLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
        translate('cmpWantPricesInCHF'),
      ],
      theirsIf: [translate('zbOtherZohoApps'), translate('zbInventory'), translate('zbNativeApps')],
      rows: {
        madeFor: translate('zbMadeFor'),
        price: translate('zbPrice'),
        yearlyCost: translate('zbYearly'),
        pricingModel: translate('zbPricingModel'),
        teamRoles: translate('zbTeamRoles'),
        documentTypes: translate('zbDocumentTypes'),
        contractTemplates: null,
        assistant: translate('zbAssistant'),
        aiImport: translate('zbAiImport'),
        signIn: translate('zbSignIn'),
        dataExport: translate('zbDataExport'),
        notifications: null,
        qrBill: translate('zbQRBill'),
        invoiceLanguages: translate('zbInvoiceLanguages'),
        reminders: true,
        depositPartial: true,
        instalments: null,
        einvoices: translate('zbEinvoices'),
        expenses: true,
        vatReturn: translate('zbVatReturn'),
        signatures: translate('zbSignatures'),
        clientPortal: true,
        retainers: translate('zbRetainers'),
        auditLog: translate('zbAuditLog'),
        apps: translate('zbApps'),
      },
    },
    {
      slug: 'bonsai',
      name: 'Bonsai',
      url: 'https://www.hellobonsai.com',
      logo: '/brands/bonsai.png',
      tone: 'lilac',
      summary: translate('bonsaiSummary'),
      checked: translate('message19November2026'),
      pricesChecked: translate('message19November2026'),
      title: internationalTitle,
      lead: `${translate('bonsaiLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpWantPricesInCHF'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
        translate('wantAnAssistantBuiltInWithNoAIAccount'),
      ],
      theirsIf: [
        translate('bonsaiAgencyPM'),
        translate('bonsaiTimeBilling'),
        translate('bonsaiCRM'),
        translate('bonsaiOwnAI'),
      ],
      rows: {
        madeFor: translate('bonsaiMadeFor'),
        price: translate('bonsaiPrice'),
        yearlyCost: translate('bonsaiYearly'),
        pricingModel: translate('bonsaiPricingModel'),
        teamRoles: translate('bonsaiTeamRoles'),
        documentTypes: translate('bonsaiDocumentTypes'),
        contractTemplates: translate('bonsaiContractTemplates'),
        assistant: translate('bonsaiAssistant'),
        aiImport: null,
        signIn: null,
        dataExport: translate('bonsaiDataExport'),
        notifications: null,
        qrBill: null,
        invoiceLanguages: null,
        reminders: true,
        depositPartial: translate('bonsaiDeposits'),
        instalments: null,
        einvoices: null,
        expenses: translate('bonsaiExpenses'),
        vatReturn: null,
        signatures: true,
        clientPortal: translate('bonsaiClientPortal'),
        retainers: translate('bonsaiRetainers'),
        auditLog: null,
        apps: translate('bonsaiApps'),
      },
    },
  ]

  const competitor = (slug: string) => COMPETITORS.find((c) => c.slug === slug)

  return { ROW_GROUPS, OURS, COMPETITORS, competitor }
})
