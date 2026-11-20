import { invitationStatus, portalLogin } from './client-portal'

test.each([
  [{ email: 'John@Home.ch', billing_email: 'books@home.ch' }, 'john@home.ch'],
  [{ email: null, billing_email: ' Client1@Domain.com ' }, 'client1@domain.com'],
  [{ email: '  ', billing_email: 'books@home.ch' }, 'books@home.ch'],
  [{ email: null, billing_email: null }, ''],
])('the portal login of %o is %j', (client, login) => {
  expect(portalLogin(client)).toBe(login)
})

test.each([
  [{}, { label: 'Not sent', tone: 'neutral', action: 'Send invitation' }],
  [
    { portal_invited_at: '2026-11-10T12:00:00Z', portal_signed_in_at: null },
    { label: 'Sent 10 Nov 2026', tone: 'blue', action: 'Resend' },
  ],
  [
    { portal_invited_at: '2026-11-10T12:00:00Z', portal_signed_in_at: '2026-11-12T08:00:00Z' },
    { label: 'Signed in 12 Nov 2026', tone: 'green', action: 'Resend' },
  ],
  // Signed in before the invitation was recorded (an older client): signed in still wins.
  [
    { portal_invited_at: null, portal_signed_in_at: '2026-10-01T08:00:00Z' },
    { label: 'Signed in 1 Oct 2026', tone: 'green', action: 'Resend' },
  ],
])('the invitation status of %o', (client, status) => {
  expect(invitationStatus(client)).toEqual(status)
})
