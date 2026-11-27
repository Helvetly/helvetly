import { documentKinds, documentTagLabel } from '@/lib/document-tags'

/**
 * What a proposed place says about a file, for its review row: the kind (its first tag when that is a kind, as
 * labelled), the client (a Clients/<client>/… path) and the year (the path's year folder).
 */
export function proposalFacts(proposal: { folder: string; tags: string[] }) {
  const parts = proposal.folder.split('/').filter(Boolean)
  const first = proposal.tags[0]
  return {
    kind: first && documentKinds.includes(first) ? documentTagLabel(first) : null,
    client: parts[0] === 'Clients' && parts[1] ? parts[1] : null,
    year: parts.find((part) => /^\d{4}$/.test(part)) ?? null,
  }
}
