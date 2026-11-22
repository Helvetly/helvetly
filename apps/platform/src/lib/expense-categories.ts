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

/** Headings of the KMU-Kontenrahmen by account prefix; the picker lists categories under them. */
const GROUPS: [prefix: string, label: () => string][] = [
  ['4', () => translate('categoryGroupGoods')],
  ['5', () => translate('categoryGroupStaff')],
  ['60', () => translate('categoryGroupPremises')],
  ['61', () => translate('categoryGroupPremises')],
  ['62', () => translate('categoryGroupVehicles')],
  ['63', () => translate('categoryGroupInsurance')],
  ['64', () => translate('categoryGroupInsurance')],
  ['65', () => translate('categoryGroupAdministration')],
  ['66', () => translate('categoryGroupMarketing')],
  ['68', () => translate('categoryGroupFinance')],
  ['69', () => translate('categoryGroupFinance')],
  ['8', () => translate('categoryGroupFinance')],
]

/** The heading a category's account sits under. */
export function categoryGroup(accountCode: string) {
  const group = GROUPS.find(([prefix]) => accountCode.startsWith(prefix))
  return group ? group[1]() : translate('categoryGroupOther')
}

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
