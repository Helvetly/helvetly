import { RedirectTo } from '@/components/redirect-to'

// The books moved out of settings: old links and bookmarks still land on the page.
export default function Page() {
  return <RedirectTo href="/books" />
}
