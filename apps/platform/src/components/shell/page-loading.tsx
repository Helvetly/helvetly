import { Loader } from '@helvetly/ui/components/loader'

/**
 * A page before its content is ready: the same header strip as every page, so the spinner sits where
 * the content will and nothing jumps.
 */
export function PageLoading() {
  return (
    <>
      <header className="sticky top-0 z-20 h-[52px] shrink-0 bg-background" />
      <Loader size="page" />
    </>
  )
}
