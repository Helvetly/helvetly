import { formatPrice } from '@helvetly/ui/lib/price'
import type { ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { PLANS, priceOf } from '@/lib/plans'
import type { Tone } from '@/lib/tones'

// Side-by-side comparisons with other Swiss business software. What each competitor offers comes from its
// own public website on the date in `checked`. Comparative advertising must be accurate and verifiable
// (UWG art. 3 para. 1 lit. e): re-check a competitor's rows against its site before changing them.
// Re-check in a browser before each release: KLARA's prices (its pages disagree), KLARA's reminders and
// roles (help pages refused automated reads) and bexio's help-centre claims.

/** true: offered; false: not offered; null: not found on their site; text: how it is offered. */
export type Cell = string | boolean | null

export type RowKey =
  | 'madeFor'
  | 'price'
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

export const ROW_GROUPS: { group: string; rows: { key: RowKey; label: string }[] }[] = [
  {
    group: translate('whoItIsFor'),
    rows: [
      { key: 'madeFor', label: translate('madeFor') },
      { key: 'price', label: translate('price2') },
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

/** Helvetly's side of every comparison. */
export const OURS: Record<RowKey, Cell> = {
  madeFor: translate('swissCompaniesOfAnySizeAloneOrAsA'),
  price: translate('fromPerPersonMonthOrPerPersonYearIncl', {
    value1: formatPrice(priceOf(PLANS[0]!, 'month')),
    value2: formatPrice(priceOf(PLANS[0]!, 'year')),
  }),
  pricingModel: translate('perPersonEveryFeatureInEveryPlan'),
  teamRoles: translate('ownerAdminsAndMembersAnyNumberOfPeople'),
  documentTypes: translate('invoicePartialPrepaymentCreditNoteDebitNoteCorrectedProforma'),
  contractTemplates: true,
  assistant: translate('heidiBuiltInAnswersFromYourRecordsAndActs'),
  aiImport: translate('pdfsImagesCSVExcelWordAndZIPFilesReviewed'),
  signIn: translate('passkeysEmailedCodesOrGoogleWithTOTPTwoFactor'),
  dataExport: translate('theWholeWorkspaceAsOneZIPAnyTime'),
  notifications: translate('eachPersonChoosesInTheAppAndByEmail'),
  qrBill: true,
  invoiceLanguages: translate('germanFrenchItalianEnglish'),
  reminders: translate('upTo10StepsWithFeesAndOR104'),
  depositPartial: true,
  instalments: true,
  einvoices: translate('xrechnungPeppolBISKSeFAndEFacturaFiles'),
  expenses: true,
  vatReturn: translate('yesWithAnESTVExportEffectiveAndNetTax'),
  signatures: true,
  clientPortal: true,
  retainers: true,
  auditLog: translate('closedMonthsAndATamperEvidentHashChainedLog'),
  apps: translate('webAppForEveryDevice'),
}

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
  title: ReactNode
  lead: string
  /** Completes "Helvetly is the better fit when you…". */
  oursIf: string[]
  /** Completes "<name> may suit you better if you…". */
  theirsIf: string[]
  rows: Record<RowKey, Cell>
}

export const COMPETITORS: Competitor[] = [
  {
    slug: 'magic-heidi',
    name: translate('magicHeidi'),
    url: 'https://magicheidi.ch',
    logo: '/brands/magic-heidi.png',
    tone: 'rose',
    summary: translate('aSimpleInvoicingAndBookkeepingAppForTheSwiss'),
    checked: translate('message11November2026'),
    title: (
      <>
        {translate('grownPastThe')}
        <span className="accent">{translate('milchbEchli')}</span>
      </>
    ),
    lead: translate('magicHeidiIsAFineAppForTheSelf'),
    oursIf: [
      translate('workAsATeamWithATrusteeOrWith'),
      translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
      translate('sendContractsForSignatureAndShareDocumentsWithClients'),
      translate('billRetainersAndNeedToSeeTheHoursLeft'),
      translate('wantAnAssistantWhoAnswersFromYourBooksAnd'),
    ],
    theirsIf: [
      translate('sendOnlyAFewInvoicesAYearAndWant'),
      translate('needNativePhoneAndDesktopApps'),
      translate('wantYourBankFeedMatchedToInvoicesAutomatically'),
      translate('sellThroughShopifyAmazonOrEtsy'),
    ],
    rows: {
      madeFor: translate('swissSelfEmployedPeopleAndSoleProprietorships'),
      price: translate('freeFor3InvoicesAnd3ReceiptsProCHF'),
      pricingModel: translate('aFreePlanThenOneProPlan'),
      teamRoles: translate('teamAndFiduciaryAccess'),
      documentTypes: translate('invoiceDepositAndPartialCreditNoteCancellationWithA'),
      contractTemplates: null,
      assistant: translate('connectsYourOwnClaudeOrChatGPT'),
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
      translate('wantEveryFeatureInEveryPlanWithNoAdd'),
    ],
    theirsIf: [
      translate('needFullBookkeepingAndAnnualFinancialStatementsInThe'),
      translate('runSwissdecCertifiedPayrollForEmployees'),
      translate('needStockManagementAlongsideInvoicing'),
      translate('workWithAFiduciaryWhoAlreadyUsesBexio'),
    ],
    rows: {
      madeFor: translate('swissSmallBusinessesStartupsTheSelfEmployedAndTheir'),
      price: translate('basicCHF35MonthBilledYearlyCHF45Monthly'),
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
    title: (
      <>
        {translate('everythingToGetPaid')}
        <span className="accent">{translate('without')}</span>
        {translate('theModules')}
      </>
    ),
    lead: translate('klaraBundlesAccountingPayrollATillAndAnOnline'),
    oursIf: [
      translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
      translate('sendContractsForSignatureAndShareDocumentsInA'),
      translate('billRetainersAndNeedToSeeTheHoursLeft'),
      translate('wantInstalmentPlansWithAQRBillForEach'),
      translate('preferOneSimplePricePerPersonToPackagesAnd'),
    ],
    theirsIf: [
      translate('wantAccountingPayrollAndInvoicingFromOneSwissVendor'),
      translate('runAShopOrVenueAndNeedATill'),
      translate('sendInvoicesByEBillEPostOrSwissPostPrint'),
      translate('wantAnOnlineShopAndBookingFromTheSame'),
    ],
    rows: {
      madeFor: translate('swissSMEsAccountingCRMOrdersPayrollAndPOSIn'),
      price: translate('businessBasicCHF69MonthOrCHF55Month'),
      pricingModel: translate('packagesPlusPaidModulesSomeChargedPerUse'),
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
      price: translate('freeUpTo70TransactionsProfessionalCHF89Year'),
      pricingModel: translate('yearlySubscriptionPerUserUnlimitedFiles'),
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
      translate('needAFreePlanForASingleUser'),
      translate('runPayrollForAFewEmployeesAlongsideTheBooks'),
      translate('manageSeveralClientCompaniesAsAFiduciary'),
    ],
    rows: {
      madeFor: translate('smesFreelancersAndFiduciariesWhoKnowDoubleEntryBookkeeping'),
      price: translate('freeFor1UserPROCHF350YearWith'),
      pricingModel: translate('freePlanThenPrepaidLicencesWithPaidExtrasPer'),
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
      translate('wantEveryFeatureInEveryPlanWithNoAdd'),
    ],
    theirsIf: [
      translate('wantAFreePlanThatIncludesAccountingAndPayroll'),
      translate('needPayrollWithELMAndSalaryCertificatesInThe'),
      translate('wantInventoryAShopOrATillInOne'),
      translate('expectToMoveToAbacusERPLater'),
    ],
    rows: {
      madeFor: translate('swissSMEsStartupsFreelancersAssociationsAndAccountants'),
      price: translate('starterFree1UserBasicCHF21Month3'),
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
      einvoices: translate('ebillAndZUGFeRDThroughThePaidAbaNetAddOn'),
      expenses: true,
      vatReturn: translate('effectiveAndNetTaxRateAsAGuideFor'),
      signatures: translate('offerSigningWithDeepSignPaid'),
      clientPortal: true,
      retainers: null,
      auditLog: null,
      apps: translate('webAppAbaClikForIOSAndAndroid'),
    },
  },
]

export const competitor = (slug: string) => COMPETITORS.find((c) => c.slug === slug)
