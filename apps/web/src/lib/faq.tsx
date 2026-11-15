import Link from 'next/link'

import type { Question } from '@/components/faq'
import { translate } from '@/lib/i18n'
import { TRIAL_DAYS } from '@/lib/plans'

export const GENERAL_FAQ: Question[] = [
  {
    q: translate('whoIsHelvetlyFor'),
    a: translate('swissCompaniesAndThePeopleWhoRunThemFrom'),
  },
  {
    q: translate('doesItCreateRealSwissQRBills'),
    a: translate('yesEveryInvoiceCanCarryTheQRBillWith'),
  },
  {
    q: translate('canHelvetlyFileMyVATReturn'),
    a: translate('helvetlyPreparesItTheFiguresPerZifferAPDF'),
  },
  {
    q: translate('whatDoesHeidiDoWithMyData'),
    a: (
      <>
        {translate('nothingLeavesForAnAIModelUntilAnOwner')}{' '}
        <Link href="/privacy">{translate('privacyPolicy')}</Link>
        {translate('andThe2')} <Link href="/subprocessors">{translate('listOfSubprocessors')}</Link>
        .
      </>
    ),
  },
  {
    q: translate('canIMoveMyExistingDataIn'),
    a: translate('yesUploadPDFsImagesSpreadsheetsWordFilesOrA'),
  },
  {
    q: translate('whatHappensIfIStopPaying'),
    a: translate('yourWorkspaceBecomesReadOnlyNothingIsDeletedYou'),
  },
]

export const PRICING_FAQ: Question[] = [
  {
    q: translate('howDoesTheTrialWork'),
    a: translate('basicStartsWithADayTrialOncePerWorkspace', { TRIAL_DAYS: TRIAL_DAYS }),
  },
  {
    q: translate('arePricesPerUser'),
    a: translate('yesEachPersonInTheWorkspaceOwnerAdminsMembers'),
  },
  {
    q: translate('isVATIncluded'),
    a: translate('yesPricesAreInCHFInSwitzerlandAndLiechtenstein'),
  },
  {
    q: translate('canIChangePlansLater'),
    a: translate('anyTimeFromTheWorkspaceSettingsMovingToA'),
  },
  {
    q: translate('whatCountsTowardsALimit'),
    a: translate('clientsProductsEngagementsAndStorageCountWhatExistsNow'),
  },
  {
    q: translate('doINeedSeveralPlansForSeveralCompanies'),
    a: translate('eachCompanyGetsItsOwnWorkspaceWithItsOwn'),
  },
]
