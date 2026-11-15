import { translate } from '@/lib/i18n'
// Passkeys in the browser. The API sends WebAuthn options as JSON (binary fields base64url) and takes
// the credential back as JSON. Browsers with PublicKeyCredential.parse*OptionsFromJSON and toJSON()
// convert natively; the fallbacks cover older ones (only a few fields are binary).

// The DOM's *JSON types widen enums to string; these keep them, and still fit the native parsers.
type DescriptorJSON = {
  type: PublicKeyCredentialType
  id: string
  transports?: AuthenticatorTransport[]
}
export type CreationOptionsJSON = Omit<
  PublicKeyCredentialCreationOptions,
  'challenge' | 'user' | 'excludeCredentials' | 'extensions'
> & {
  challenge: string
  user: { id: string; name: string; displayName: string }
  excludeCredentials?: DescriptorJSON[]
}
export type RequestOptionsJSON = Omit<
  PublicKeyCredentialRequestOptions,
  'challenge' | 'allowCredentials' | 'extensions'
> & { challenge: string; allowCredentials?: DescriptorJSON[] }

const fromBase64Url = (value: string): ArrayBuffer => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer
}

const toBase64Url = (buffer: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const descriptor = (d: DescriptorJSON): PublicKeyCredentialDescriptor => ({
  ...d,
  id: fromBase64Url(d.id),
})

function creationOptions(json: CreationOptionsJSON): PublicKeyCredentialCreationOptions {
  if (typeof PublicKeyCredential.parseCreationOptionsFromJSON === 'function') {
    return PublicKeyCredential.parseCreationOptionsFromJSON(json)
  }
  return {
    ...json,
    user: { ...json.user, id: fromBase64Url(json.user.id) },
    challenge: fromBase64Url(json.challenge),
    excludeCredentials: json.excludeCredentials?.map(descriptor),
  }
}

function requestOptions(json: RequestOptionsJSON): PublicKeyCredentialRequestOptions {
  if (typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function') {
    return PublicKeyCredential.parseRequestOptionsFromJSON(json)
  }
  return {
    ...json,
    challenge: fromBase64Url(json.challenge),
    allowCredentials: json.allowCredentials?.map(descriptor),
  }
}

function credentialJson(credential: PublicKeyCredential): unknown {
  if (typeof credential.toJSON === 'function') return credential.toJSON()
  const r = credential.response
  const response =
    r instanceof AuthenticatorAttestationResponse
      ? {
          clientDataJSON: toBase64Url(r.clientDataJSON),
          attestationObject: toBase64Url(r.attestationObject),
          transports: r.getTransports(),
        }
      : r instanceof AuthenticatorAssertionResponse
        ? {
            clientDataJSON: toBase64Url(r.clientDataJSON),
            authenticatorData: toBase64Url(r.authenticatorData),
            signature: toBase64Url(r.signature),
            userHandle: r.userHandle ? toBase64Url(r.userHandle) : undefined,
          }
        : { clientDataJSON: toBase64Url(r.clientDataJSON) }
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response,
    clientExtensionResults: credential.getClientExtensionResults(),
  }
}

function expectPasskey(credential: Credential | null): PublicKeyCredential {
  if (credential instanceof PublicKeyCredential) return credential
  throw new DOMException(translate('noPasskeyWasChosen'), 'NotAllowedError')
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
}

export async function createPasskey(options: CreationOptionsJSON) {
  const credential = await navigator.credentials.create({ publicKey: creationOptions(options) })
  return credentialJson(expectPasskey(credential))
}

/** A prompt, or with mediation "conditional" the email field's autofill. */
export async function getPasskey(
  options: RequestOptionsJSON,
  init: { mediation?: CredentialMediationRequirement; signal?: AbortSignal } = {},
) {
  const credential = await navigator.credentials.get({
    publicKey: requestOptions(options),
    ...init,
  })
  return credentialJson(expectPasskey(credential))
}

export async function passkeyAutofillAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false
  if (typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function') return false
  return PublicKeyCredential.isConditionalMediationAvailable().catch(() => false)
}

/** The person closed the browser's prompt, or it was aborted or timed out: nothing to report. */
export function passkeyCancelled(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  )
}

/** A default name for a new passkey: "Mac", "iPhone", "Windows PC". */
export function deviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return translate('androidPhone')
  if (/Macintosh|Mac OS X/.test(ua)) return translate('mac')
  if (/Windows/.test(ua)) return translate('windowsPC')
  if (/Linux/.test(ua)) return translate('linuxComputer')
  return translate('passkey')
}
