'use client'

import { describedBy, FormField, HelpTip } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import { Loader } from '@helvetly/ui/components/loader'
import { BriefcaseBusiness } from 'lucide-react'

import { Combobox, NativeSelect } from '@/components/clients/fields'
import { LoadProblem } from '@/components/data/load-problem'
import { apiFieldErrors, useSectionForm } from '@/components/section-form'
import {
  useCountries,
  useEmploymentSettings,
  useSaveEmploymentSettings,
  type Country,
  type EmploymentSettings as Settings,
} from '@/lib/employees'
import { useCan } from '@/lib/permissions'

import { FieldGrid, SettingsPage, SettingsSection } from './layout'
import { SettingsHeader } from './settings-tabs'

export function EmploymentSettings() {
  const settings = useEmploymentSettings()
  const countries = useCountries()
  return (
    <>
      <SettingsHeader />
      <SettingsPage
        title="Employment"
        description="The company that employs your staff and where it is based. New employees start from it; each employee keeps their own place of work."
      >
        {settings.error ? (
          <LoadProblem
            error={settings.error}
            what="The employment settings"
            onRetry={() => void settings.refetch()}
          />
        ) : settings.data && countries.data ? (
          <ProfileCard settings={settings.data} countries={countries.data} />
        ) : (
          <Loader className="min-h-36" />
        )}
      </SettingsPage>
    </>
  )
}

function ProfileCard({ settings, countries }: { settings: Settings; countries: Country[] }) {
  const writable = useCan('write:employees')
  const save = useSaveEmploymentSettings()
  const form = useSectionForm({
    initial: {
      employing_entity: settings.employing_entity ?? '',
      country: settings.country ?? '',
      region: settings.region ?? '',
    },
    sections: [{ id: 'profile', fields: ['employing_entity', 'country', 'region'] }],
    save: (values) =>
      save.mutateAsync({
        employing_entity: values.employing_entity.trim() || null,
        country: values.country || null,
        region: values.region || null,
      }),
    fieldErrors: (error) => apiFieldErrors(error),
    savedMessage: () => 'Employment settings saved.',
  })
  const section = form.section('profile')
  const country = countries.find((entry) => entry.code === form.values.country)
  const regionLabel = country?.region_label ?? 'Region'

  return (
    <SettingsSection
      id="employment-profile"
      icon={BriefcaseBusiness}
      title={
        <span className="inline-flex items-center gap-1.5">
          Company employment profile
          <HelpTip label="the employment profile">
            Suggests defaults for new employees. It never decides an employee&rsquo;s obligations;
            set each employee&rsquo;s place of work.
          </HelpTip>
        </span>
      }
      description={
        writable
          ? 'Pre-fills the employer and country of work in the new employee form.'
          : 'Only people who can edit employees can change this.'
      }
      section={writable ? section : undefined}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          section.save()
        }}
        noValidate
      >
        <FieldGrid>
          <FormField
            id="employment-entity"
            label="Employing company"
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
          <FormField id="employment-country" label="Country" width="md" error={form.errors.country}>
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
                placeholder="Choose a country"
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
                <option value="">No {regionLabel.toLowerCase()}</option>
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
  )
}
