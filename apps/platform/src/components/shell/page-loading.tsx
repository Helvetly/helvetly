import { Loader } from '@helvetly/ui/components/loader'

/**
 * A page before its content is ready: the same header strip as every page, so the spinner sits where
 * the content will and nothing jumps. The spinner fades in after a beat, so it sits in a section of its
 * own: the section after the header is the white panel, and it must not fade with it (a grey flash).
 */
export function PageLoading() {
  return (
    <>
      <header className="sticky top-0 z-20 h-[52px] shrink-0 bg-background" />
      <div className="flex flex-1 flex-col">
        <Loader size="page" />
      </div>
    </>
  )
}
