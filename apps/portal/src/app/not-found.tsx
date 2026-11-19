import { PortalNotFound } from '@/components/portal-not-found'

/** The portal's 404.html: the Go server answers it for unknown pages and unknown /w/<slug>/ addresses. */
export default function NotFound() {
  return <PortalNotFound />
}
