'use client'

import { Callout } from '@helvetly/ui/components/callout'
import { describedBy, FormField, HelpTip } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { SwitchRow } from '@helvetly/ui/components/switch-row'
import { BriefcaseBusiness, ShieldCheck, UserRound } from 'lucide-react'
import Link from 'next/link'

import { Combobox, NativeSelect } from '@/components/clients/fields'
import { LoadProblem } from '@/components/data/load-problem'
import { HrLockNotice, useHrAccess, type HrAccess } from '@/components/employees/hr-access'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import {
  useCountries,
  useEmploymentSettings,
  useSaveEmploymentSettings,
  type Country,
  type EmploymentSettings as Settings,
} from '@/lib/employees'
import { translate } from '@/lib/i18n'

import { FieldGrid, SettingsPage, SettingsSection } from './layout'
import { SettingsHeader } from './settings-tabs'

export function EmploymentSettings() {
  const hr = useHrAccess()
  const settings = useEmploymentSettings(!hr.blocked)
  const countries = useCountries()
  return (
    <>
      <SettingsHeader />
      <HrLockNotice hr={hr} />
      <SettingsPage
        title={translate('employmentSettingsTitle')}
        description={translate('employmentSettingsDescription')}
      >
        {hr.blocked ? null : settings.error ? (
          <LoadProblem
            error={settings.error}
            what={translate('employmentSettingsWhat')}
            onRetry={() => void settings.refetch()}
          />
        ) : settings.data && countries.data ? (
          <SettingsForm settings={settings.data} countries={countries.data} hr={hr} />
        ) : (
          <Loader className="min-h-36" />
        )}
      </SettingsPage>
    </>
  )
}

/** Why the settings cannot be changed here, or null when they can. */
function readOnlyReason(hr: HrAccess) {
  if (hr.lockReason) return hr.lockReason
  return hr.writeEmployees && hr.writePayroll ? null : translate('employmentSettingsReadOnly')
}

function SettingsForm({
  settings,
  countries,
  hr,
}: {
  settings: Settings
  countries: Country[]
  hr: HrAccess
}) {
  const readOnly = readOnlyReason(hr)
  const writable = readOnly === null
  const save = useSaveEmploymentSettings()
  const form = useSectionForm({
    initial: {
      employing_entity: settings.employing_entity ?? '',
      country: settings.country ?? '',
      region: settings.region ?? '',
      require_second_approver: settings.require_second_approver,
    },
    sections: [
      { id: 'profile', fields: ['employing_entity', 'country', 'region'] },
      { id: 'approval', fields: ['require_second_approver'] },
    ],
    save: (values) =>
      save.mutateAsync({
        employing_entity: values.employing_entity.trim() || null,
        country: values.country || null,
        region: values.region || null,
        require_second_approver: values.require_second_approver,
      }),
    fieldErrors: (error) => apiFieldErrors(error),
    savedMessage: () => translate('employmentSettingsSaved'),
  })
  const profile = form.section('profile')
  const approval = form.section('approval')
  const country = countries.find((entry) => entry.code === form.values.country)
  const regionLabel = country?.region_label ?? translate('employmentRegion')
  const approvers = save.data?.payroll_approvers ?? settings.payroll_approvers

  return (
    <>
      <SettingsSection
        id="employment-profile"
        icon={BriefcaseBusiness}
        title={
          <span className="inline-flex items-center gap-1.5">
            {translate('employmentProfileTitle')}
            <HelpTip label={translate('employmentProfileLabel')}>
              {translate('employmentProfileTip')}
            </HelpTip>
          </span>
        }
        description={readOnly ?? translate('employmentProfileDescription')}
        section={writable ? profile : undefined}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            profile.save()
          }}
          noValidate
        >
          <FieldGrid>
            <FormField
              id="employment-entity"
              label={translate('employeeEmployingEntity')}
              width="md"
              error={form.errors.employing_entity}
            >
              <Input
                {...describedBy('employment-entity', form.errors.employing_entity)}
                maxLength={200}
                disabled={!writable}
                value={form.values.employing_entity}
                onChange={(event) => form.set('employing_entity', event.target.value)}
              />
            </FormField>
            <FormField
              id="employment-country"
              label={translate('employeeAddressCountry')}
              width="md"
              error={form.errors.country}
            >
              {writable ? (
                <Combobox
                  id="employment-country"
                  value={form.values.country}
                  options={countries.map((entry) => ({
                    value: entry.code,
                    label: entry.name,
                    hint: entry.code,
                  }))}
                  invalid={Boolean(form.errors.country)}
                  placeholder={translate('employeeChooseCountry')}
                  onChange={(next) => {
                    form.set('country', next)
                    form.set('region', '')
                  }}
                />
              ) : (
                <Input id="employment-country" disabled value={country?.name ?? ''} />
              )}
            </FormField>
            {country?.regions && (
              <FormField
                id="employment-region"
                label={regionLabel}
                width="md"
                error={form.errors.region}
              >
                <NativeSelect
                  {...describedBy('employment-region', form.errors.region)}
                  disabled={!writable}
                  value={form.values.region}
                  onChange={(event) => form.set('region', event.target.value)}
                >
                  <option value="">
                    {translate('employmentNoRegion', { region: regionLabel.toLowerCase() })}
                  </option>
                  {country.regions.map((region) => (
                    <option key={region.code} value={region.code}>
                      {region.name}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
            )}
          </FieldGrid>
        </form>
      </SettingsSection>

      <SettingsSection
        id="employment-approval"
        icon={ShieldCheck}
        title={translate('employmentApprovalTitle')}
        section={writable ? approval : undefined}
      >
        <SwitchRow
          id="employment-second-approver"
          label={
            <span className="inline-flex items-center gap-1.5">
              {translate('employmentSecondApprover')}
              <HelpTip label={translate('employmentSecondApprover')}>
                {translate('employmentSecondApproverTip')}
              </HelpTip>
            </span>
          }
          checked={form.values.require_second_approver}
          onCheckedChange={(on) => form.set('require_second_approver', on)}
          disabledReason={readOnly ?? undefined}
        />
        {form.values.require_second_approver && approvers < 2 && (
          <Callout tone="warning" icon={UserRound} className="mt-3">
            {translate('employmentNobodyElse')}{' '}
            <Link href="/members" className="underline underline-offset-4">
              {translate('employmentOpenMembers')}
            </Link>
          </Callout>
        )}
      </SettingsSection>
    </>
  )
}
