import { RedirectTo } from '@/components/redirect-to'

// API & MCP moved out of settings to its own page: old links and bookmarks still land on it.
export default function Page() {
  return <RedirectTo href="/developers" />
}
