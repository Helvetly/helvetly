import { ApiSettings } from '@/components/api/api-settings'
import { PageTitle } from '@/components/page-title'

export default function ApiPage() {
  return (
    <>
      <PageTitle message="apiMCP" />
      <ApiSettings />
    </>
  )
}
