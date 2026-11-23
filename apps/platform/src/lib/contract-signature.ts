import { API_PREFIX } from '@helvetly/ui/lib/http'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request, type ApiError } from '@/lib/api'

/**
 * Your own signature for contracts in this workspace: an image you drew or uploaded (private to you) and the place
 * you sign at ("" = the workspace's city, `default_place`). Written contracts print it on the contractor's side.
 */
export type ContractSignature = { has_image: boolean; place: string; default_place: string }

const PATH = '/account/contract-signature'
const signatureKey = ['contract-signature'] as const

/** The image's address; `version` changes with each upload so the browser shows the new one. */
export const signatureImageUrl = (version: number) => `${API_PREFIX}${PATH}/image?v=${version}`

export function useContractSignature() {
  return useQuery({
    queryKey: signatureKey,
    queryFn: async () => (await request<{ data: ContractSignature }>(PATH)).data,
  })
}

function useSave<T>(mutationFn: (input: T) => Promise<{ data: ContractSignature }>) {
  const queryClient = useQueryClient()
  return useMutation<{ data: ContractSignature }, ApiError, T>({
    mutationFn,
    onSuccess: ({ data }) => queryClient.setQueryData(signatureKey, data),
  })
}

/** Stores a new image (PNG or JPEG) in place of the old one. */
export function useUploadSignature() {
  return useSave((image: Blob) => {
    const form = new FormData()
    form.append('file', image, image.type === 'image/jpeg' ? 'signature.jpg' : 'signature.png')
    return request(`${PATH}/image`, { method: 'PUT', form })
  })
}

export function useRemoveSignature() {
  return useSave(() => request(`${PATH}/image`, { method: 'DELETE' }))
}

export function useSignaturePlace() {
  return useSave((place: string) => request(PATH, { method: 'PUT', json: { place } }))
}
