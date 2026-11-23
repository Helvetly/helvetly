import type { CategoryRef, VatTreatment } from '@/lib/expenses'
import { translate } from '@/lib/i18n'

/** The catalogue's categories (the API's store.CategoryPresets) in the user's language. */
export const PRESET_LABELS: Record<string, () => string> = {
  materials: () => translate('expenseCategoryMaterials'),
  goods_resale: () => translate('expenseCategoryGoodsResale'),
  subcontractors: () => translate('expenseCategorySubcontractors'),
  staff_other: () => translate('expenseCategoryStaffOther'),
  training: () => translate('expenseCategoryTraining'),
  staff_expenses: () => translate('expenseCategoryStaffExpenses'),
  rent: () => translate('expenseCategoryRent'),
  premises_ancillary: () => translate('expenseCategoryPremisesAncillary'),
  cleaning: () => translate('expenseCategoryCleaning'),
  repairs: () => translate('expenseCategoryRepairs'),
  equipment_leasing: () => translate('expenseCategoryEquipmentLeasing'),
  vehicles: () => translate('expenseCategoryVehicles'),
  fuel: () => translate('expenseCategoryFuel'),
  vehicle_insurance: () => translate('expenseCategoryVehicleInsurance'),
  vehicle_tax: () => translate('expenseCategoryVehicleTax'),
  vehicle_leasing: () => translate('expenseCategoryVehicleLeasing'),
  freight: () => translate('expenseCategoryFreight'),
  insurance: () => translate('expenseCategoryInsurance'),
  duties_permits: () => translate('expenseCategoryDutiesPermits'),
  energy: () => translate('expenseCategoryEnergy'),
  waste: () => translate('expenseCategoryWaste'),
  office: () => translate('expenseCategoryOffice'),
  telecom: () => translate('expenseCategoryTelecom'),
  postage: () => translate('expenseCategoryPostage'),
  memberships: () => translate('expenseCategoryMemberships'),
  donations: () => translate('expenseCategoryDonations'),
  professional_fees: () => translate('expenseCategoryProfessionalFees'),
  software_saas: () => translate('expenseCategorySoftwareSaas'),
  it_services: () => translate('expenseCategoryItServices'),
  hardware_small: () => translate('expenseCategoryHardwareSmall'),
  marketing: () => translate('expenseCategoryMarketing'),
  gifts: () => translate('expenseCategoryGifts'),
  trade_fairs: () => translate('expenseCategoryTradeFairs'),
  travel: () => translate('expenseCategoryTravel'),
  lodging: () => translate('expenseCategoryLodging'),
  meals_entertainment: () => translate('expenseCategoryMealsEntertainment'),
  other_operating: () => translate('expenseCategoryOtherOperating'),
  interest: () => translate('expenseCategoryInterest'),
  bank_fees: () => translate('expenseCategoryBankFees'),
  direct_taxes: () => translate('expenseCategoryDirectTaxes'),
  wages: () => translate('expenseCategoryWages'),
  temp_staff: () => translate('expenseCategoryTempStaff'),
  social_security: () => translate('expenseCategorySocialSecurity'),
  family_allowances: () => translate('expenseCategoryFamilyAllowances'),
  pension_bvg: () => translate('expenseCategoryPensionBvg'),
  accident_insurance: () => translate('expenseCategoryAccidentInsurance'),
  sickness_insurance: () => translate('expenseCategorySicknessInsurance'),
  recruiting: () => translate('expenseCategoryRecruiting'),
  staff_meals: () => translate('expenseCategoryStaffMeals'),
  customs: () => translate('expenseCategoryCustoms'),
  tools: () => translate('expenseCategoryTools'),
  home_office: () => translate('expenseCategoryHomeOffice'),
  vehicle_repairs: () => translate('expenseCategoryVehicleRepairs'),
  property_insurance: () => translate('expenseCategoryPropertyInsurance'),
  liability_insurance: () => translate('expenseCategoryLiabilityInsurance'),
  office_supplies: () => translate('expenseCategoryOfficeSupplies'),
  books_subscriptions: () => translate('expenseCategoryBooksSubscriptions'),
  consulting: () => translate('expenseCategoryConsulting'),
  audit: () => translate('expenseCategoryAudit'),
  web_hosting: () => translate('expenseCategoryWebHosting'),
  public_transport: () => translate('expenseCategoryPublicTransport'),
  entertainment: () => translate('expenseCategoryEntertainment'),
  licences: () => translate('expenseCategoryLicences'),
  depreciation: () => translate('expenseCategoryDepreciation'),
  payment_fees: () => translate('expenseCategoryPaymentFees'),
}

/** A category's name as shown: a catalogue entry in the user's language, one someone named as stored. */
export function categoryLabel(category: Pick<CategoryRef, 'name' | 'preset'>) {
  const label = category.preset ? PRESET_LABELS[category.preset] : undefined
  return label ? label() : category.name
}

export type CategoryGroupKey =
  | 'goods'
  | 'staff'
  | 'premises'
  | 'vehicles'
  | 'insurance'
  | 'administration'
  | 'marketing'
  | 'finance'
  | 'other'

/** Headings of the KMU-Kontenrahmen by account prefix; the picker lists categories under them. */
const GROUPS: [prefix: string, group: CategoryGroupKey][] = [
  ['4', 'goods'],
  ['5', 'staff'],
  ['60', 'premises'],
  ['61', 'premises'],
  ['62', 'vehicles'],
  ['63', 'insurance'],
  ['64', 'insurance'],
  ['65', 'administration'],
  ['66', 'marketing'],
  ['68', 'finance'],
  ['69', 'finance'],
  ['8', 'finance'],
]

export const GROUP_LABELS: Record<CategoryGroupKey, () => string> = {
  goods: () => translate('categoryGroupGoods'),
  staff: () => translate('categoryGroupStaff'),
  premises: () => translate('categoryGroupPremises'),
  vehicles: () => translate('categoryGroupVehicles'),
  insurance: () => translate('categoryGroupInsurance'),
  administration: () => translate('categoryGroupAdministration'),
  marketing: () => translate('categoryGroupMarketing'),
  finance: () => translate('categoryGroupFinance'),
  other: () => translate('categoryGroupOther'),
}

/** The groups in account order, Other last. */
export const GROUP_KEYS = Object.keys(GROUP_LABELS) as CategoryGroupKey[]

/** The group a category's account sits under. */
export function categoryGroupKey(accountCode: string): CategoryGroupKey {
  return GROUPS.find(([prefix]) => accountCode.startsWith(prefix))?.[1] ?? 'other'
}

/** The heading a category's account sits under. */
export function categoryGroup(accountCode: string) {
  return GROUP_LABELS[categoryGroupKey(accountCode)]()
}

/** The expense accounts of the Swiss SME chart of accounts a category usually books to, in the user's language. */
export const CHART_ACCOUNTS: Record<string, () => string> = {
  '4000': () => translate('kmu4000'),
  '4070': () => translate('kmu4070'),
  '4200': () => translate('kmu4200'),
  '4400': () => translate('kmu4400'),
  '5000': () => translate('kmu5000'),
  '5700': () => translate('kmu5700'),
  '5800': () => translate('kmu5800'),
  '5900': () => translate('kmu5900'),
  '6000': () => translate('kmu6000'),
  '6100': () => translate('kmu6100'),
  '6105': () => translate('kmu6105'),
  '6200': () => translate('kmu6200'),
  '6260': () => translate('kmu6260'),
  '6300': () => translate('kmu6300'),
  '6360': () => translate('kmu6360'),
  '6400': () => translate('kmu6400'),
  '6500': () => translate('kmu6500'),
  '6530': () => translate('kmu6530'),
  '6570': () => translate('kmu6570'),
  '6600': () => translate('kmu6600'),
  '6640': () => translate('kmu6640'),
  '6700': () => translate('kmu6700'),
  '6800': () => translate('kmu6800'),
  '6900': () => translate('kmu6900'),
  '6940': () => translate('kmu6940'),
  '8900': () => translate('kmu8900'),
}

/** A free account number someone types: four digits, as in the SME chart. */
export const isAccountNumber = (value: string) => /^\d{4}$/.test(value)

/** The Swiss rates of each treatment, from 2024 and before (the document's date decides). */
const RATES: Record<VatTreatment, [since2024: string, before: string]> = {
  standard: ['8.1', '7.7'],
  reduced: ['2.6', '2.5'],
  lodging: ['3.8', '3.7'],
  exempt: ['0', '0'],
  none: ['0', '0'],
}

/** The line rate a category's VAT treatment suggests on a document date (today when empty); null: no suggestion. */
export function treatmentRate(treatment: VatTreatment | null | undefined, date: string) {
  if (!treatment) return null
  const [current, before] = RATES[treatment]
  return date && date < '2024-01-01' ? before : current
}

export const VAT_TREATMENT_LABELS: Record<VatTreatment, () => string> = {
  standard: () => translate('vatTreatmentStandard'),
  reduced: () => translate('vatTreatmentReduced'),
  lodging: () => translate('vatTreatmentLodging'),
  exempt: () => translate('vatTreatmentExempt'),
  none: () => translate('vatTreatmentNone'),
}

/** Short names for a category's VAT badge. */
export const VAT_BADGE_LABELS: Record<VatTreatment, () => string> = {
  standard: () => translate('vatBadgeStandard'),
  reduced: () => translate('vatBadgeReduced'),
  lodging: () => translate('vatBadgeLodging'),
  exempt: () => translate('vatBadgeExempt'),
  none: () => translate('vatBadgeNone'),
}

/** "Standard 8.1%", "No VAT": a treatment with the rate it suggests today. */
export function vatBadge(treatment: VatTreatment, date: string) {
  const rate = treatmentRate(treatment, date)
  return `${VAT_BADGE_LABELS[treatment]()}${rate && rate !== '0' ? ` ${rate}%` : ''}`
}
