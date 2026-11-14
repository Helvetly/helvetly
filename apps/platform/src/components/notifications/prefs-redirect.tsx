'use client'

import { PageLoading } from '@/components/shell/page-loading'

import { useRedirectToPrefs } from './prefs-drawer'

export function PrefsRedirect() {
  useRedirectToPrefs()
  return <PageLoading />
}
