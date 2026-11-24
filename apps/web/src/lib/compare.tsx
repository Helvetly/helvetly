import { localeDetails } from '@helvetly/i18n'
import type { ReactNode } from 'react'

import { perLanguage } from '@/lib/i18n'
import { plansIn } from '@/lib/plans'
import {
  FREE_PLAN,
  PRO_TRIAL_DAYS,
  TEAM_SIZES,
  TIERED_PLANS,
  type TieredPlanId,
  yearlyFor,
} from '@/lib/team-pricing'
import type { Tone } from '@/lib/tones'

// Side-by-side comparisons with other business software used in Switzerland. What each competitor offers comes from its
// own public website on the date in `checked`, its prices on the date in `pricesChecked`. Comparative advertising must be accurate and verifiable
// (UWG art. 3 para. 1 lit. e): re-check a competitor's rows against its site before changing them, and never add a
// competitor fact without its source and date. Every cell is a tick, a dash or a short value; the detail goes in its note.
// Re-check in a browser before each release: KLARA's prices (its pages disagree), KLARA's reminders and
// roles (help pages refused automated reads) and bexio's help-centre claims. For the international tools (read
// 19 November 2026): Xero's help centre (central.xero.com, an empty page to automated reads: deposits, roles,
// lock dates, export, notifications), Bonsai's help centre (help.hellobonsai.com, 403: sign-in, export, partial
// payments), Zoho's mobile apps page (403), QuickBooks' promo fine print and its global prices (loaded live) and
// which Zoho plans include Zia. Zoho's prices for Switzerland are the EUR group of its pricing page's own table.

/** true: offered; false: not offered; null: not found on their site (unknown); text: how it is offered, in a few words. */
export const NOT_COMPARED = Symbol('not compared')
export type Value = string | boolean | null | typeof NOT_COMPARED
/** A value with the detail behind it, shown in a (?) next to it. */
export type Cell = { value: Value; note?: string }
/** A bare value, or a value and its note. */
export type Entry = Value | [Value, string]

/** The longest short value a cell may hold; anything longer belongs in its note. */
export const MAX_CELL_LENGTH = 40

export const ROW_KEYS = [
  'madeFor',
  'apps',
  'freePlan',
  'paidFrom',
  'pricingModel',
  'qrBill',
  'invoiceLanguages',
  'reminders',
  'depositPartial',
  'instalments',
  'einvoices',
  'sessions',
  'calendarSync',
  'documents',
  'documentFiling',
  'signatures',
  'contracts',
  'approvals',
  'clientPortal',
  'ownDomain',
  'retainers',
  'vatReturn',
  'expenses',
  'bookkeeping',
  'bankFeeds',
  'auditLog',
  'assistant',
  'aiImport',
  'teamRoles',
  'signIn',
  'payroll',
  'dataExport',
  'api',
  'hosting',
] as const

export type RowKey = (typeof ROW_KEYS)[number]

/** The rows where Helvetly's cell quotes a price, shown only while the API's offer confirms it. */
export const PRICE_ROWS: ReadonlySet<RowKey> = new Set(['freePlan', 'paidFrom', 'pricingModel'])

export type YearlyPrices = {
  /** The package priced, by the other product's own name. */
  plan: string
  /** A year for each of TEAM_SIZES, as listed (currency included); null when the source does not say. */
  prices: (string | null)[]
  note: string
}

export type Competitor = {
  slug: string
  name: string
  url: string
  priceUrl: string
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
  /** The verdict: what they are good at, and where Helvetly differs. */
  lead: string
  /** Up to four reasons to switch; each completes "Helvetly is the better fit when you…". */
  oursIf: string[]
  /** Completes "<name> may suit you better if you…". */
  theirsIf: string[]
  yearly: YearlyPrices
  rows: Record<RowKey, Entry>
}

export const cellOf = (entry: Entry): Cell =>
  Array.isArray(entry) ? { value: entry[0], note: entry[1] } : { value: entry }

/** The comparisons with other business software, in one language. */
export const compareIn = perLanguage((translate, language) => {
  const { count, plansWith, planById, LIMITS } = plansIn(language)
  const numberLocale = localeDetails(language).numberLocale
  /** CHF 1’431, USD 508.40: the source's own figure, in Swiss thousands. */
  const money = (currency: string, amount: number) =>
    `${currency} ${
      Number.isInteger(amount)
        ? count(amount)
        : amount.toLocaleString(numberLocale, { minimumFractionDigits: 2 }).replaceAll("'", '’')
    }`
  const chf = (amount: number) => money('CHF', amount)
  const perMonth = (price: string) => translate('cmpPerMonth', { price })
  const perYear = (price: string) => translate('cmpPerYear', { price })
  const fromPlan = (plan: string) => translate('cmpFromPlan', { plan })
  const name = (id: TieredPlanId) => planById(id).name
  const priceCheck = new Intl.DateTimeFormat(localeDetails(language).languageTag, {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date('2026-11-24T00:00:00Z'))

  const ROW_LABELS: Record<RowKey, string> = {
    madeFor: translate('madeFor'),
    apps: translate('apps'),
    freePlan: translate('cmpFreePlan'),
    paidFrom: translate('cmpPaidFrom'),
    pricingModel: translate('pricingModel'),
    qrBill: translate('swissQRBill'),
    invoiceLanguages: translate('invoiceLanguages'),
    reminders: translate('automaticReminders'),
    depositPartial: translate('depositAndPartialInvoices'),
    instalments: translate('cmpInstalments'),
    einvoices: translate('eInvoices'),
    sessions: translate('cmpSessions'),
    calendarSync: translate('cmpCalendarSync'),
    documentFiling: translate('cmpDocumentFilingLabel'),
    documents: translate('cmpDocumentStorage'),
    signatures: translate('electronicSignatures'),
    contracts: translate('cmpContracts'),
    approvals: translate('cmpApprovals'),
    clientPortal: translate('clientPortal'),
    ownDomain: translate('cmpOwnDomain'),
    retainers: translate('cmpRetainers'),
    vatReturn: translate('vatReturn'),
    expenses: translate('expensesWithReceipts'),
    bookkeeping: translate('cmpBookkeeping'),
    bankFeeds: translate('cmpBankFeeds'),
    auditLog: translate('closedPeriodsAndAuditLog'),
    assistant: translate('cmpAssistant'),
    aiImport: translate('importFromYourFilesWithAI'),
    teamRoles: translate('teamAndRoles'),
    signIn: translate('signIn2'),
    payroll: translate('cmpPayroll'),
    dataExport: translate('exportOfAllYourData'),
    hosting: translate('cmpHostingLabel'),
    api: translate('cmpApi'),
  }

  const group = (title: string, keys: RowKey[]) => ({
    group: title,
    rows: keys.map((key) => ({ key, label: ROW_LABELS[key] })),
  })

  const ROW_GROUPS = [
    group(translate('cmpIncludedInHelvetly'), [
      'qrBill',
      'einvoices',
      'clientPortal',
      'ownDomain',
      'documentFiling',
      'hosting',
    ]),
    group(translate('whoItIsFor'), ['madeFor', 'apps']),
    group(translate('cmpGroupPrice'), ['freePlan', 'paidFrom', 'pricingModel']),
    group(translate('gettingPaid2'), [
      'invoiceLanguages',
      'reminders',
      'depositPartial',
      'instalments',
    ]),
    group(translate('cmpScheduling'), ['sessions', 'calendarSync']),
    group(translate('cmpGroupDocuments'), ['documents', 'signatures', 'contracts', 'approvals']),
    group(translate('cmpGroupClients'), ['retainers']),
    group(translate('cmpGroupBooks'), [
      'vatReturn',
      'expenses',
      'bookkeeping',
      'bankFeeds',
      'auditLog',
    ]),
    group(translate('ai'), ['assistant', 'aiImport']),
    group(translate('cmpGroupTeam'), ['teamRoles', 'signIn', 'payroll']),
    group(translate('cmpGroupData'), ['dataExport', 'api']),
  ]

  const { basic, pro, business } = TIERED_PLANS
  /** Helvetly's year for each team size, per plan (Business includes five people). */
  const HELVETLY_YEARLY = (['basic', 'pro', 'business'] as const).map((id) => ({
    id,
    plan: name(id),
    prices: TEAM_SIZES.map((people) => chf(yearlyFor(id, people))),
  }))

  /** Helvetly's side of every comparison. */
  const OURS: Record<RowKey, Entry> = {
    madeFor: [translate('cmpUsMadeFor'), translate('swissCompaniesOfAnySizeAloneOrAsA')],
    apps: translate('webAppForEveryDevice'),
    freePlan: [
      translate('cmpUsFree'),
      translate('cmpUsFreeNote', {
        invoices: FREE_PLAN.invoices,
        quotes: FREE_PLAN.quotes,
        clients: FREE_PLAN.clients,
        expenses: FREE_PLAN.expenses,
        sessions: FREE_PLAN.sessions,
      }),
    ],
    paidFrom: [
      perMonth(chf(basic.monthly)),
      translate('cmpUsPricesNote', {
        basic: chf(basic.monthly),
        pro: chf(pro.monthly),
        business: chf(business.monthly),
        basicPeople: basic.includedPeople,
        proPeople: pro.includedPeople,
        businessPeople: business.includedPeople,
        days: PRO_TRIAL_DAYS,
      }),
    ],
    pricingModel: [
      translate('cmpUsModel'),
      translate('cmpUsModelNote', {
        basicExtra: chf(basic.extraPerson),
        proExtra: chf(pro.extraPerson),
        businessExtra: chf(business.extraPerson),
      }),
    ],
    qrBill: true,
    invoiceLanguages: 'DE, FR, IT, EN',
    reminders: [
      translate('cmpUsReminders'),
      translate('upTo10StepsWithFeesAndOR1042', { value1: plansWith('automations') }),
    ],
    depositPartial: [
      true,
      translate('invoicePartialPrepaymentProformaAndSelfBilledCreditNote', {
        value1: plansWith('corrections_vat'),
      }),
    ],
    instalments: [true, translate('with', { value1: plansWith('automations') })],
    einvoices: [
      'XRechnung, Peppol, Factur-X, KSeF',
      translate('cmpUsEinvoicesNote', { plans: plansWith('einvoice_xml') }),
    ],
    sessions: [true, translate('cmpUsSessionsNote')],
    calendarSync: ['Google, Microsoft', translate('cmpUsCalendarNote')],
    documentFiling: [
      true,
      translate('cmpDocumentFilingOurs', { value1: plansWith('automations') }),
    ],
    documents: [translate('cmpUsDocuments'), translate('cmpUsDocumentsNote')],
    signatures: [
      true,
      translate('simpleElectronicSignaturesWithNoQualifiedSignatures', {
        value1: plansWith('templates_signatures'),
      }),
    ],
    contracts: [
      true,
      translate('cmpUsContractsNote', { plans: plansWith('templates_signatures') }),
    ],
    approvals: [true, translate('cmpUsApprovalsNote', { plan: name('business') })],
    clientPortal: [true, translate('in', { value1: plansWith('client_portal') })],
    ownDomain: [true, translate('cmpUsDomainNote', { plan: name('business') })],
    retainers: [
      true,
      translate('yesUpToActiveInBasicManagedByHand', {
        basic: LIMITS.engagements.values.basic,
      }),
    ],
    vatReturn: [
      'eCH-0217 XML',
      translate('withEffectiveAndNetTaxRateAsTheECH', { value1: plansWith('corrections_vat') }),
    ],
    expenses: [true, translate('with', { value1: plansWith('expenses') })],
    bookkeeping: [
      translate('cmpUsBooks'),
      translate('cmpUsBooksNote', { plans: plansWith('ledger_exports') }),
    ],
    bankFeeds: false,
    auditLog: [translate('cmpUsAudit'), translate('closedMonthsAndATamperEvidentHashChainedLog')],
    assistant: [
      translate('cmpUsAssistant'),
      translate('heidiWithAnswersFromYourRecordsAndActsOnly', { value1: plansWith('heidi') }),
    ],
    aiImport: [translate('cmpUsImport'), translate('pdfsImagesCSVExcelWordAndZIPFilesReviewed2')],
    teamRoles: [translate('cmpUsTeam'), translate('cmpUsTeamNote')],
    signIn: [translate('cmpUsSignIn'), translate('passkeysEmailedCodesOrGoogleWithTOTPTwoFactor')],
    payroll: [
      translate('cmpUsPayroll'),
      translate('cmpUsPayrollNote', { plans: plansWith('employees') }),
    ],
    dataExport: [
      translate('cmpUsExport'),
      translate('singleDocumentsInEveryPlanBusinessDataTheWhole', {
        value1: plansWith('ledger_exports'),
      }),
    ],
    hosting: [true, translate('cmpHostingOurs')],
    api: [translate('cmpUsApi'), translate('cmpUsApiNote')],
  }

  const COMPETITORS: Competitor[] = [
    {
      slug: 'magic-heidi',
      name: translate('magicHeidi'),
      url: 'https://magicheidi.ch',
      priceUrl: 'https://magicheidi.ch/pricing',
      logo: '/brands/magic-heidi.png',
      tone: 'rose',
      summary: translate('aSimpleInvoicingAndBookkeepingAppForTheSwiss'),
      checked: translate('message11November2026'),
      pricesChecked: priceCheck,
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
        translate('cmpBookSessions'),
      ],
      theirsIf: [
        translate('wantOnePriceHoweverManyPeopleWorkInIt'),
        translate('needNativePhoneAndDesktopApps'),
        translate('wantYourBankFeedMatchedToInvoicesAutomatically'),
        translate('sellThroughShopifyAmazonOrEtsy'),
      ],
      yearly: {
        plan: 'Pro',
        prices: [chf(299), chf(299), chf(299)],
        note: translate('freeFor3InvoicesAnd3ReceiptsProCHF'),
      },
      rows: {
        madeFor: [
          translate('cmpSwissSelfEmployed'),
          translate('swissSelfEmployedPeopleAndSoleProprietorships'),
        ],
        apps: [translate('cmpNativeApps'), translate('nativeAppsForIPhoneAndroidMacAndWindowsAnd')],
        freePlan: [translate('cmpMhFree'), translate('freeFor3InvoicesAnd3ReceiptsProCHF')],
        paidFrom: [perMonth(chf(39)), translate('freeFor3InvoicesAnd3ReceiptsProCHF')],
        pricingModel: [translate('cmpOnePriceAnyTeam'), translate('aFreePlanThenOneProPlanWithNo')],
        qrBill: true,
        invoiceLanguages: 'DE, FR, IT, EN',
        reminders: true,
        depositPartial: [true, translate('invoiceDepositAndPartialCreditNoteCancellationWithA')],
        instalments: null,
        einvoices: null,
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: null,
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: null,
        ownDomain: null,
        retainers: null,
        vatReturn: [
          translate('cmpFiguresByHand'),
          translate('effectiveAndNetTaxRateFiguresTransferredToThe'),
        ],
        expenses: true,
        bookkeeping: [true, translate('aSimpleInvoicingAndBookkeepingAppForTheSwiss')],
        bankFeeds: true,
        auditLog: null,
        assistant: [
          translate('cmpOwnAIViaMcp'),
          translate('connectsYourOwnClaudeOrChatGPTThroughMCPAn'),
        ],
        aiImport: ['Excel, CSV, PDF', translate('excelCSVOrPDFWithAIColumnMapping')],
        teamRoles: [translate('cmpTeamFiduciary'), translate('teamAndFiduciaryAccess')],
        signIn: [
          translate('cmpGoogleAppleCode'),
          translate('googleAppleOrAnEmailedCodeWithOptionalTwo'),
        ],
        payroll: NOT_COMPARED,
        dataExport: translate('everythingAsAZIPAnyTime'),
        api: ['API, MCP', translate('connectsYourOwnClaudeOrChatGPTThroughMCPAn')],
      },
    },
    {
      slug: 'bexio',
      name: translate('bexio'),
      url: 'https://www.bexio.com',
      priceUrl: 'https://www.bexio.com/en-CH/packages-and-prices',
      logo: '/brands/bexio.svg',
      tone: 'sky',
      summary: translate('aBroadSwissBusinessSuiteWithAccountingPayrollAnd'),
      checked: translate('message11November2026'),
      pricesChecked: priceCheck,
      title: (
        <>
          {translate('builtToGetYouPaid')}
          <span className="accent">{translate('not')}</span>
          {translate('toRunAnERP')}
        </>
      ),
      lead: translate('cmpBexioVerdict'),
      oursIf: [
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
        translate('cmpBookSessions'),
      ],
      theirsIf: [
        translate('needFullBookkeepingAndAnnualFinancialStatementsInThe'),
        translate('runSwissdecCertifiedPayrollForEmployees'),
        translate('needStockManagementAlongsideInvoicing'),
        translate('workWithAFiduciaryWhoAlreadyUsesBexio'),
      ],
      yearly: {
        plan: 'Advanced / Optima',
        prices: [chf(545), chf(895), chf(895)],
        note: translate('advancedCHF504For12UsersOptimaCHF'),
      },
      rows: {
        madeFor: [
          translate('cmpSmallBusinesses'),
          translate('swissSmallBusinessesStartupsTheSelfEmployedAndTheir'),
        ],
        apps: [translate('cmpWebIOSAndroid'), translate('webAppBexioGoForIOSAndAndroid')],
        freePlan: null,
        paidFrom: [
          translate('cmpPerMonthExclVat', { price: chf(35) }),
          translate('basicCHF35AdvancedCHF42OptimaCHF69'),
        ],
        pricingModel: [
          translate('cmpTiersByUsers'),
          translate('fourTiersByFeaturesAndIncludedUsersPlusAdd'),
        ],
        qrBill: true,
        invoiceLanguages: [
          translate('cmpPerDocument'),
          translate('multilingualTemplatesLanguagePerDocument'),
        ],
        reminders: translate('automaticWithConfigurableLevels'),
        depositPartial: [true, translate('invoiceCreditNoteAndPartialInvoicesFromAnOrder')],
        instalments: null,
        einvoices: translate('ebillThroughAnIntegration'),
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: null,
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: null,
        ownDomain: null,
        retainers: null,
        vatReturn: [
          translate('cmpFiguresByHand'),
          translate('effectiveAndNetTaxRateFiguresTransferredToThe'),
        ],
        expenses: translate('fromTheAdvancedPlan'),
        bookkeeping: [true, translate('aBroadSwissBusinessSuiteWithAccountingPayrollAnd')],
        bankFeeds: true,
        auditLog: [translate('cmpLockedYears'), translate('fiscalYearsCanBeLocked')],
        assistant: null,
        aiImport: [
          translate('cmpAiReadsReceipts'),
          translate('aiReadsReceiptsAndQRInvoicesAdvancedAndUp'),
        ],
        teamRoles: [
          translate('cmpUsersPerPlan'),
          translate('usersPerPlanWithPermissionsFreeFiduciaryAccess'),
        ],
        signIn: [
          translate('cmpPasswordCode'),
          translate('passwordAndAnEmailedCodeOptionalAuthenticatorApp'),
        ],
        payroll: [
          translate('cmpPayrollAddOn'),
          translate('fourTiersByFeaturesAndIncludedUsersPlusAdd'),
        ],
        dataExport: translate('perModuleAsExcelOrPDF'),
        api: [
          translate('cmpMarketplace'),
          translate('aBroadSwissBusinessSuiteWithAccountingPayrollAnd'),
        ],
      },
    },
    {
      slug: 'klara',
      name: 'KLARA',
      url: 'https://www.klara.ch',
      priceUrl: 'https://www.klara.ch/en/business',
      logo: '/brands/klara.png',
      tone: 'peach',
      summary: translate('aModularSMESuiteWithAccountingPayrollPOSAnd'),
      checked: translate('message11November2026'),
      pricesChecked: priceCheck,
      title: (
        <>
          {translate('everythingToGetPaid')}
          <span className="accent">{translate('without')}</span>
          {translate('theModules')}
        </>
      ),
      lead: translate('cmpKlaraVerdict'),
      oursIf: [
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
        translate('billRetainersAndNeedToSeeTheHoursLeft'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
      ],
      theirsIf: [
        translate('wantAccountingPayrollAndInvoicingFromOneSwissVendor'),
        translate('runAShopOrVenueAndNeedATill'),
        translate('sendInvoicesByEBillEPostOrSwissPostPrint'),
        translate('wantAnOnlineShopAndBookingFromTheSame'),
      ],
      yearly: {
        plan: 'Business Basic',
        prices: [chf(713), chf(713), null],
        note: translate('businessBasicCHF660660OnAYearlyPlan'),
      },
      rows: {
        madeFor: [
          translate('cmpSwissSmes'),
          translate('swissSMEsAccountingCRMOrdersPayrollAndPOSIn'),
        ],
        apps: [translate('cmpWebMobilePos'), translate('webAppMyKLARAForIOSAndAndroidAPOS')],
        freePlan: null,
        paidFrom: [
          translate('cmpPerMonthExclVat', { price: chf(55) }),
          translate('businessBasicCHF69MonthCHF55YearlyCHF'),
        ],
        pricingModel: [
          translate('cmpPackagesModules'),
          translate('packagesPlusPaidModulesSuchAsBudgetEArchiveInventory'),
        ],
        qrBill: true,
        invoiceLanguages: null,
        reminders: [translate('cmpThreeLevels'), translate('threeLevelsSentAfterConfirmation')],
        depositPartial: [true, translate('invoiceCreditNoteCollectiveAndRecurringInvoices')],
        instalments: null,
        einvoices: translate('ebillAndEPost'),
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: [
          translate('cmpOnlineBooking'),
          translate('aModularSMESuiteWithAccountingPayrollPOSAnd'),
        ],
        calendarSync: NOT_COMPARED,
        documents: [
          translate('cmpEArchiveModule'),
          translate('packagesPlusPaidModulesSuchAsBudgetEArchiveInventory'),
        ],
        signatures: null,
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: null,
        ownDomain: null,
        retainers: null,
        vatReturn: [translate('cmpXmlFile'), translate('effectiveAndNetTaxRateWithAnXMLFile')],
        expenses: true,
        bookkeeping: [true, translate('swissSMEsAccountingCRMOrdersPayrollAndPOSIn')],
        bankFeeds: true,
        auditLog: null,
        assistant: [translate('cmpOutsideAI'), translate('connectsAnOutsideChatGPTOrClaude')],
        aiImport: translate('aiReceiptScanning'),
        teamRoles: [
          translate('cmpManyRoles'),
          translate('rolesForAdminsTrusteesPayrollAccountingAndMore'),
        ],
        signIn: [translate('cmpPasswordAuthApp'), translate('passwordOptionalAuthenticatorApp')],
        payroll: [
          translate('cmpPayrollModule'),
          translate('packagesPlusPaidModulesSuchAsBudgetEArchiveInventory'),
        ],
        dataExport: [translate('cmpPerArea'), translate('perAreaSuchAsCustomersOrReports')],
        api: 'MCP',
      },
    },
    {
      slug: 'banana',
      name: translate('banana'),
      url: 'https://www.banana.ch',
      priceUrl: 'https://www.banana.ch/en/prices',
      logo: '/brands/banana.png',
      tone: 'lemon',
      summary: translate('lowCostDesktopAccountingSoftwareForPeopleWhoKeep'),
      checked: translate('message11November2026'),
      pricesChecked: priceCheck,
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
        translate('wantAnAssistantWhoAnswersFromYourRecords'),
      ],
      theirsIf: [
        translate('wantDesktopSoftwareThatKeepsYourFilesOnYour'),
        translate('needDoubleEntryBookkeepingAtALowYearlyPrice'),
        translate('keepManyClientsBooksAsAnAccountantOnOne'),
        translate('wantAFreePlanForVerySmallBooks'),
      ],
      yearly: {
        plan: 'Advanced',
        prices: [chf(179), chf(537), chf(895)],
        note: translate('advancedWithTheVATXMLCHF179537VAT'),
      },
      rows: {
        madeFor: [
          translate('cmpSmallFirmsAccountants'),
          translate('smallCompaniesAssociationsPrivatePeopleAndAccountants'),
        ],
        apps: [translate('cmpDesktopMobileWeb'), translate('windowsMacAndLinuxIOSAndroidAndAWeb')],
        freePlan: [
          translate('cmpUpTo70Transactions'),
          translate('freeUpTo70TransactionsProfessionalCHF89Year2'),
        ],
        paidFrom: [perYear(chf(89)), translate('freeUpTo70TransactionsProfessionalCHF89Year2')],
        pricingModel: [
          translate('cmpLicencePerUser'),
          translate('yearlyLicencePerUserForUpTo5Devices'),
        ],
        qrBill: true,
        invoiceLanguages: 'DE, FR, IT, EN',
        reminders: [translate('cmpPrintedByHand'), translate('printedByHandUpToThreeLevels')],
        depositPartial: [null, translate('invoiceAndCreditNoteProformaInAdvanced')],
        instalments: null,
        einvoices: null,
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: null,
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: null,
        ownDomain: null,
        retainers: null,
        vatReturn: [translate('cmpXmlFile'), translate('effectiveAndNetTaxRateWithAnXMLFile2')],
        expenses: translate('entriesLinkedToPDFReceipts'),
        bookkeeping: [true, translate('lowCostDesktopAccountingSoftwareForPeopleWhoKeep')],
        bankFeeds: null,
        auditLog: [
          translate('cmpHashChainedCodes'),
          translate('lockedEntriesWithHashChainedControlCodes'),
        ],
        assistant: [
          translate('cmpOutsideTheApp'),
          translate('chatgptHelpersOutsideTheAppChatGPTPlus'),
        ],
        aiImport: null,
        teamRoles: [
          translate('cmpOneEditorPerFile'),
          translate('multiUserSubscriptionsOnePersonEditsAFileAt'),
        ],
        signIn: [translate('cmpLocalFiles'), translate('localFilesWithAnOptionalFilePassword')],
        payroll: NOT_COMPARED,
        dataExport: [translate('cmpOnYourComputer'), translate('yourFilesStayOnYourOwnComputer')],
        api: NOT_COMPARED,
      },
    },
    {
      slug: 'cashctrl',
      name: translate('cashctrl'),
      url: 'https://cashctrl.com',
      priceUrl: 'https://cashctrl.com/en/info/pro',
      logo: '/brands/cashctrl.png',
      tone: 'mint',
      summary: translate('onlineDoubleEntryAccountingForPeopleWhoKeepTheir'),
      checked: translate('message11November2026'),
      pricesChecked: priceCheck,
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
      ],
      theirsIf: [
        translate('wantFullDoubleEntryBookkeepingWithYearEndClosing'),
        translate('runPayrollForAFewEmployeesAlongsideTheBooks'),
        translate('manageSeveralClientCompaniesAsAFiduciary'),
      ],
      yearly: {
        plan: 'PRO',
        prices: [chf(350), chf(350), chf(508.4)],
        note: translate('freeFor1UserPROCHF350YearWith2'),
      },
      rows: {
        madeFor: [
          translate('cmpKnowDoubleEntry'),
          translate('smesFreelancersAndFiduciariesWhoKnowDoubleEntryBookkeeping'),
        ],
        apps: [
          translate('cmpComputersOnly'),
          translate('webAppForComputersPhoneBrowsersNotSupported'),
        ],
        freePlan: [translate('cmpOneUser'), translate('freeFor1UserPROCHF350YearWith2')],
        paidFrom: [perYear(chf(350)), translate('freeFor1UserPROCHF350YearWith2')],
        pricingModel: [
          translate('cmpPrepaidLicences'),
          translate('freePlanThenPrepaidLicences612Or24'),
        ],
        qrBill: true,
        invoiceLanguages: 'DE, FR, IT, EN',
        reminders: [translate('cmpByHand'), translate('reminderDocumentsCreatedByHand')],
        depositPartial: [null, translate('invoiceAndCreditNoteOffersAndMoreInPRO')],
        instalments: null,
        einvoices: null,
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: null,
        contracts: translate('lettersFromTextTemplates'),
        approvals: NOT_COMPARED,
        clientPortal: null,
        ownDomain: null,
        retainers: null,
        vatReturn: [translate('cmpXmlFile'), translate('effectiveAndNetTaxRateWithAnXMLFile')],
        expenses: translate('asPurchaseInvoices'),
        bookkeeping: [true, translate('onlineDoubleEntryAccountingForPeopleWhoKeepTheir')],
        bankFeeds: null,
        auditLog: true,
        assistant: null,
        aiImport: null,
        teamRoles: [
          translate('cmpCustomRoles'),
          translate('rolesForAdminsGuestsAndTrusteesAndCustomOnes'),
        ],
        signIn: [translate('cmpPasswordPasskeys2fa'), translate('passwordPasskeysAndTwoFactor')],
        payroll: [true, translate('runPayrollForAFewEmployeesAlongsideTheBooks')],
        dataExport: translate('perModuleDocumentsAsZIP'),
        api: 'API',
      },
    },
    {
      slug: 'abaninja',
      name: translate('abaninja'),
      url: 'https://abaninja.ch',
      priceUrl: 'https://www.abaninja.ch/en/#pricing',
      logo: '/brands/abaninja.png',
      tone: 'lilac',
      summary: translate('invoicingAccountingAndPayrollFromTheAbacusWorldWith'),
      checked: translate('message11November2026'),
      pricesChecked: priceCheck,
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
      ],
      theirsIf: [
        translate('wantAFreePlanThatIncludesAccountingAndPayroll'),
        translate('needPayrollWithELMAndSalaryCertificatesInThe'),
        translate('wantInventoryAShopOrATillInOne'),
        translate('expectToMoveToAbacusERPLater'),
      ],
      yearly: {
        plan: 'Basic / Pro',
        prices: [chf(252), chf(252), chf(588)],
        note: translate('starterFree1User1000DocumentsAYear'),
      },
      rows: {
        madeFor: [
          translate('cmpSwissSmes'),
          translate('swissSMEsStartupsFreelancersAssociationsAndAccountants'),
        ],
        apps: [translate('cmpWebIOSAndroid'), translate('webAppAbaClikForIOSAndAndroid')],
        freePlan: [translate('cmpAbaFree'), translate('starterFree1User1000DocumentsAYear')],
        paidFrom: [perMonth(chf(21)), translate('starterFree1User1000DocumentsAYear')],
        pricingModel: [
          translate('cmpTiersUsersDocuments'),
          translate('freePlanThenTiersLimitedByUsersPayrollRuns'),
        ],
        qrBill: true,
        invoiceLanguages: 'DE, FR, IT, EN',
        reminders: [
          translate('cmpUpToThreeLevels'),
          translate('upToThreeLevelsSentAutomaticallyOrByHand'),
        ],
        depositPartial: [true, translate('invoiceAdvancePartialInstalmentAndCreditNote')],
        instalments: [translate('cmpFromAnOrder'), translate('instalmentInvoicesFromAnOrder')],
        einvoices: [translate('cmpEbillPaid'), translate('ebillThroughAbaNet21AMonthInBasicThen')],
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: [translate('cmpDeepSignPaid'), translate('offerSigningWithDeepSignPaid')],
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: true,
        ownDomain: null,
        retainers: null,
        vatReturn: [translate('cmpGuideForForm'), translate('effectiveAndNetTaxRateAsAGuideFor')],
        expenses: true,
        bookkeeping: [true, translate('invoicingAccountingAndPayrollFromTheAbacusWorldWith')],
        bankFeeds: true,
        auditLog: null,
        assistant: translate('samuraiActsAfterConfirmation'),
        aiImport: [translate('cmpAiReadsPdfs'), translate('aiReadsPDFInvoicesAndReceipts')],
        teamRoles: [translate('cmpGroupsPerArea'), translate('userGroupsWithPermissionsPerArea')],
        signIn: [
          translate('cmpPasswordOrSocial'),
          translate('passwordGoogleAppleOrMicrosoftOptionalTwoFactor'),
        ],
        payroll: [
          translate('cmpPayrollElm'),
          translate('needPayrollWithELMAndSalaryCertificatesInThe'),
        ],
        dataExport: [
          translate('cmpPerAppNotFull'),
          translate('perApplicationNoFullDatabaseExport'),
        ],
        api: [fromPlan('Basic'), 'API'],
      },
    },
    {
      slug: 'quickbooks',
      name: 'QuickBooks Online',
      url: 'https://quickbooks.intuit.com',
      priceUrl: 'https://quickbooks.intuit.com/pricing/',
      logo: '/brands/quickbooks.png',
      tone: 'mint',
      summary: translate('qbSummary'),
      checked: translate('message19November2026'),
      pricesChecked: priceCheck,
      title: translate('helvetlyVs', { name: 'QuickBooks Online' }),
      lead: `${translate('qbLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpInvoiceInGermanFrenchItalian'),
        translate('sendContractsForSignatureAndShareDocumentsInA'),
      ],
      theirsIf: [
        translate('cmpWantBankFeeds'),
        translate('cmpWorkWithAccountantWhoUses', { name: 'QuickBooks' }),
        translate('qbNeedInventory'),
        translate('needNativePhoneAndDesktopApps'),
      ],
      yearly: {
        plan: 'Essentials / Plus',
        prices: [money('USD', 1020), money('USD', 1020), money('USD', 1680)],
        note: `${translate('qbYearly')}. ${translate('qbPrice')}`,
      },
      rows: {
        madeFor: [translate('cmpNoSwissEdition'), translate('qbMadeFor')],
        apps: [translate('cmpWebMobileDesktop'), translate('qbApps')],
        freePlan: [translate('cmpQbFree'), translate('qbPrice')],
        paidFrom: [perMonth(money('USD', 38)), translate('qbPrice')],
        pricingModel: [translate('cmpTiersUserCaps'), translate('qbPricingModel')],
        qrBill: null,
        invoiceLanguages: [translate('cmpNoGerman'), translate('qbInvoiceLanguages')],
        reminders: true,
        depositPartial: [true, translate('qbDocumentTypes')],
        instalments: null,
        einvoices: [translate('cmpSomeCountries'), translate('qbEinvoices')],
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: [translate('cmpEstimatesOnly'), translate('qbSignatures')],
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: null,
        ownDomain: null,
        retainers: [translate('cmpNoHourBalance'), translate('qbRetainers')],
        vatReturn: [null, translate('cmpVATByCountryNoSwiss')],
        expenses: true,
        bookkeeping: [true, translate('qbSummary')],
        bankFeeds: [true, translate('qbSummary')],
        auditLog: [translate('cmpLockAndLog'), translate('qbAuditLog')],
        assistant: [translate('cmpAiAgentsEnglish'), translate('qbAssistant')],
        aiImport: [translate('cmpBillsAndReceipts'), translate('qbAiImport')],
        teamRoles: [translate('cmpUsersByPlan'), translate('qbTeamRoles')],
        signIn: [translate('cmpAccountMfaPasskeys'), translate('qbSignIn')],
        payroll: [translate('cmpPayrollAddOn'), translate('qbPricingModel')],
        dataExport: [translate('cmpFullBackupTopPlan'), translate('qbDataExport')],
        api: NOT_COMPARED,
      },
    },
    {
      slug: 'xero',
      name: 'Xero',
      url: 'https://www.xero.com',
      priceUrl: 'https://www.xero.com/pricing-plans/',
      logo: '/brands/xero.svg',
      tone: 'sky',
      summary: translate('xeroSummary'),
      checked: translate('message19November2026'),
      pricesChecked: priceCheck,
      title: translate('helvetlyVs', { name: 'Xero' }),
      lead: `${translate('xeroLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpWantPricesInCHF'),
        translate('cmpInvoiceInGermanFrenchItalian'),
      ],
      theirsIf: [
        translate('cmpWorkWithAccountantWhoUses', { name: 'Xero' }),
        translate('cmpWantBankFeeds'),
        translate('xeroManyApps'),
        translate('xeroUKPayroll'),
      ],
      yearly: {
        plan: 'Standard',
        prices: [money('USD', 648), money('USD', 648), money('USD', 648)],
        note: `${translate('xeroYearly')}. ${translate('xeroPricingModel')}`,
      },
      rows: {
        madeFor: [translate('cmpNoSwissEdition'), translate('xeroMadeFor')],
        apps: translate('cmpWebIOSAndroid'),
        freePlan: null,
        paidFrom: [perMonth(money('USD', 7)), translate('xeroPrice')],
        pricingModel: [translate('cmpNoPerUserFees'), translate('xeroPricingModel')],
        qrBill: [translate('cmpThirdPartyApp'), translate('xeroQRBill')],
        invoiceLanguages: null,
        reminders: true,
        depositPartial: [null, translate('xeroDocumentTypes')],
        instalments: null,
        einvoices: [translate('cmpSomeCountries'), translate('xeroEinvoices')],
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: null,
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: null,
        ownDomain: null,
        retainers: null,
        vatReturn: [null, translate('cmpVATByCountryNoSwiss')],
        expenses: true,
        bookkeeping: [true, translate('xeroSummary')],
        bankFeeds: [true, translate('xeroSummary')],
        auditLog: null,
        assistant: ['JAX', translate('xeroAssistant')],
        aiImport: [translate('cmpBillsAndReceipts'), translate('xeroAiImport')],
        teamRoles: [translate('cmpNoPerUserFees'), translate('xeroTeamRoles')],
        signIn: [translate('cmpPasswordMfa'), translate('xeroSignIn')],
        payroll: [translate('cmpSomeCountries'), translate('xeroUKPayroll')],
        dataExport: null,
        api: [translate('cmpMarketplace'), translate('xeroSummary')],
      },
    },
    {
      slug: 'freshbooks',
      name: 'FreshBooks',
      url: 'https://www.freshbooks.com',
      priceUrl: 'https://www.freshbooks.com/pricing',
      logo: '/brands/freshbooks.svg',
      tone: 'peach',
      summary: translate('fbSummary'),
      checked: translate('message19November2026'),
      pricesChecked: priceCheck,
      title: translate('helvetlyVs', { name: 'FreshBooks' }),
      lead: `${translate('fbLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpWantPricesInCHF'),
        translate('needEInvoicesForGermanyPolandRomaniaOrPeppol'),
      ],
      theirsIf: [
        translate('fbTrackTime'),
        translate('fbProposals'),
        translate('fbManyLanguages'),
        translate('cmpWantNativePhoneApps'),
      ],
      yearly: {
        plan: 'Lite',
        prices: [money('USD', 276), money('USD', 540), money('USD', 804)],
        note: `${translate('fbYearly')}. ${translate('fbPrice')}`,
      },
      rows: {
        madeFor: [translate('cmpFreelancersServices'), translate('fbMadeFor')],
        apps: translate('cmpWebIOSAndroid'),
        freePlan: null,
        paidFrom: [perMonth(money('USD', 23)), translate('fbPrice')],
        pricingModel: [translate('cmpTiersByClients'), translate('fbPricingModel')],
        qrBill: null,
        invoiceLanguages: [translate('cmpSixteenLanguages'), translate('fbInvoiceLanguages')],
        reminders: true,
        depositPartial: [true, translate('fbDocumentTypes')],
        instalments: [translate('cmpUpTo12Payments'), translate('fbInstalments')],
        einvoices: null,
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: [translate('cmpProposalsFromPlus'), translate('fbSignatures')],
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: true,
        ownDomain: null,
        retainers: [fromPlan('Plus'), translate('fbRetainers')],
        vatReturn: [null, translate('cmpVATByCountryNoSwiss')],
        expenses: [true, translate('fbExpenses')],
        bookkeeping: [true, translate('fbSummary')],
        bankFeeds: true,
        auditLog: [translate('cmpLockAndLog'), translate('fbAuditLog')],
        assistant: [translate('cmpOwnAIReadOnly'), translate('fbAssistant')],
        aiImport: [translate('cmpReceiptsSomeCountries'), translate('fbAiImport')],
        teamRoles: [translate('cmpRolesFreeAccountant'), translate('fbTeamRoles')],
        signIn: [translate('cmpPasswordGoogleApple'), translate('fbSignIn')],
        payroll: NOT_COMPARED,
        dataExport: [translate('cmpPerTypeCsvPdf'), translate('fbDataExport')],
        api: NOT_COMPARED,
      },
    },
    {
      slug: 'zoho-books',
      name: 'Zoho Books',
      url: 'https://www.zoho.com/books/',
      priceUrl: 'https://www.zoho.com/books/pricing/',
      logo: '/brands/zoho-books.png',
      tone: 'lemon',
      summary: translate('zbSummary'),
      checked: translate('message19November2026'),
      pricesChecked: priceCheck,
      title: translate('helvetlyVs', { name: 'Zoho Books' }),
      lead: `${translate('zbLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
        translate('cmpWantPricesInCHF'),
      ],
      theirsIf: [translate('zbOtherZohoApps'), translate('zbInventory'), translate('zbNativeApps')],
      yearly: {
        plan: 'Standard',
        prices: [money('EUR', 120), money('EUR', 120), null],
        note: `${translate('zbYearly')}. ${translate('zbPricingModel')}`,
      },
      rows: {
        madeFor: [translate('cmpSmallFirmsAccountants'), translate('zbMadeFor')],
        apps: translate('zbApps'),
        freePlan: [true, translate('zbPrice')],
        paidFrom: [perMonth(money('EUR', 10)), translate('zbPrice')],
        pricingModel: [translate('cmpTiersPerOrganisation'), translate('zbPricingModel')],
        qrBill: [translate('cmpPaidThirdParty'), translate('zbQRBill')],
        invoiceLanguages: [null, translate('zbInvoiceLanguages')],
        reminders: true,
        depositPartial: [true, translate('zbDocumentTypes')],
        instalments: null,
        einvoices: [translate('cmpSomeCountries'), translate('zbEinvoices')],
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: NOT_COMPARED,
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: [`Zoho Sign, ${fromPlan('Premium')}`, translate('zbSignatures')],
        contracts: null,
        approvals: NOT_COMPARED,
        clientPortal: true,
        ownDomain: null,
        retainers: [fromPlan('Professional'), translate('zbRetainers')],
        vatReturn: [translate('cmpTaxSummaryOnly'), translate('zbVatReturn')],
        expenses: true,
        bookkeeping: [true, translate('zbSummary')],
        bankFeeds: true,
        auditLog: [translate('cmpLockAndLog'), translate('zbAuditLog')],
        assistant: ['Zia', translate('zbAssistant')],
        aiImport: [translate('cmpDocumentScan'), translate('zbAiImport')],
        teamRoles: [translate('cmpUsersByPlan'), translate('zbTeamRoles')],
        signIn: [translate('cmpAccountMfaPasskeys'), translate('zbSignIn')],
        payroll: NOT_COMPARED,
        dataExport: [translate('cmpFullBackup15Days'), translate('zbDataExport')],
        api: [translate('cmpZohoApps'), translate('zbSummary')],
      },
    },
    {
      slug: 'bonsai',
      name: 'Bonsai',
      url: 'https://www.hellobonsai.com',
      priceUrl: 'https://www.hellobonsai.com/pricing',
      logo: '/brands/bonsai.png',
      tone: 'lilac',
      summary: translate('bonsaiSummary'),
      checked: translate('message19November2026'),
      pricesChecked: priceCheck,
      title: translate('helvetlyVs', { name: 'Bonsai' }),
      lead: `${translate('bonsaiLead')} ${translate('cmpLeadHelvetly')}`,
      oursIf: [
        translate('cmpNeedSwissQRBill'),
        translate('wantTheECH0217FileToImportYourVAT'),
        translate('cmpWantPricesInCHF'),
        translate('wantInstalmentPlansWithAQRBillForEach'),
      ],
      theirsIf: [
        translate('bonsaiAgencyPM'),
        translate('bonsaiTimeBilling'),
        translate('bonsaiCRM'),
        translate('bonsaiOwnAI'),
      ],
      yearly: {
        plan: 'Essentials',
        prices: [money('USD', 228), money('USD', 684), money('USD', 1140)],
        note: `${translate('bonsaiYearly')}. ${translate('bonsaiPricingModel')}`,
      },
      rows: {
        madeFor: [translate('cmpAgenciesFreelancers'), translate('bonsaiMadeFor')],
        apps: [translate('cmpWebMobileDesktop'), translate('bonsaiApps')],
        freePlan: null,
        paidFrom: [
          translate('cmpPerPersonMonth', { price: money('USD', 9) }),
          translate('bonsaiPrice'),
        ],
        pricingModel: [translate('cmpPerPersonTiers'), translate('bonsaiPricingModel')],
        qrBill: null,
        invoiceLanguages: null,
        reminders: true,
        depositPartial: [translate('cmpOnApproval'), translate('bonsaiDeposits')],
        instalments: null,
        einvoices: null,
        documentFiling: NOT_COMPARED,
        hosting: NOT_COMPARED,
        sessions: [translate('cmpScheduling'), translate('bonsaiCRM')],
        calendarSync: NOT_COMPARED,
        documents: null,
        signatures: true,
        contracts: [translate('cmpContractTemplates'), translate('bonsaiContractTemplates')],
        approvals: NOT_COMPARED,
        clientPortal: [fromPlan('Essentials'), translate('bonsaiClientPortal')],
        ownDomain: null,
        retainers: [translate('cmpHoursNotStated'), translate('bonsaiRetainers')],
        vatReturn: null,
        expenses: [fromPlan('Essentials'), translate('bonsaiExpenses')],
        bookkeeping: null,
        bankFeeds: null,
        auditLog: null,
        assistant: [translate('cmpOwnAIViaMcp'), translate('bonsaiAssistant')],
        aiImport: null,
        teamRoles: [translate('cmpEveryUserPaid'), translate('bonsaiTeamRoles')],
        signIn: null,
        payroll: NOT_COMPARED,
        dataExport: [translate('cmpScopeNotStated'), translate('bonsaiDataExport')],
        api: ['MCP', translate('bonsaiAssistant')],
      },
    },
  ]

  const competitor = (slug: string) => COMPETITORS.find((c) => c.slug === slug)

  return { ROW_GROUPS, ROW_LABELS, OURS, HELVETLY_YEARLY, COMPETITORS, competitor }
})
