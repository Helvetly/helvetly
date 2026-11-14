'use client'

import { siteUrl } from '@/lib/site'

import { LoginShowcase } from './login-showcase'
import { SignIn, useSignedInElsewhere } from './sign-in'

/**
 * The login page. Nothing of it shows until the session check says nobody is signed in, so someone
 * who is never sees the sign-in screen flash before being sent on.
 */
export function LoginScreen() {
  const leaving = useSignedInElsewhere()
  if (leaving) return <div aria-busy="true" className="min-h-svh bg-card" />
  return (
    <div className="grid min-h-svh animate-in bg-card duration-200 fade-in-0 lg:grid-cols-2">
      <main className="flex flex-col px-4 py-10">
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-[22.5rem]">
            <SignIn />
          </div>
        </div>
        <p className="pt-10 text-center text-xs text-muted-foreground">
          By continuing, you agree to our{' '}
          <a href={siteUrl('/terms')} className="font-medium text-foreground underline">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href={siteUrl('/privacy')} className="font-medium text-foreground underline">
            Privacy Policy
          </a>
          .
        </p>
      </main>
      <LoginShowcase className="m-3 hidden lg:flex" />
    </div>
  )
}
