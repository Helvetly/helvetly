import type { Page } from '@playwright/test'

import { expect, join, object, test, text, type FinancialAPI, type Person } from './fixtures'

// Approval before issuing on the real API and screens: groups and a policy set up in Settings, a draft submitted,
// decided by other people in their own sessions, issued once approved; a rejection and an edit send it back.
// Billing is off in E2E, so every plan feature (document_approvals included) is allowed.

async function draft(api: FinancialAPI) {
  return text((await api.draft(await api.client())).id)
}

const approval = async (api: FinancialAPI, id: string) => api.read(`/invoices/${id}/approval`)
/** A decision names the request the person saw, as the drawer does: the open one, read in their own session. */
async function act(
  api: FinancialAPI,
  id: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  const decides = action === 'approve' || action === 'reject'
  const request_id = decides ? (await approval(api, id)).request_id : undefined
  return api.write(
    `/invoices/${id}/approval${action ? `/${action}` : ''}`,
    decides ? { ...data, request_id } : data,
  )
}

async function openDrawer(page: Page, id: string) {
  await page.goto(`/invoices?id=${id}`)
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  return drawer
}

/** The invoice policy through the API: one rule, from a group of these people or (none given) from anyone. */
async function setUp(owner: FinancialAPI, members: string[] | null) {
  let groupId: string | null = null
  if (members) {
    const response = await owner.write('/approvals/groups', {
      name: 'Management',
      member_ids: members,
    })
    expect(response.status()).toBe(201)
    groupId = text(object(object(await response.json()).data).id)
  }
  await owner.save(
    '/approvals/policies/invoice',
    { enabled: true, min_total: null, rules: [{ group_id: groupId, min: 1 }] },
    'PUT',
  )
}

/** Settings → Approvals: a new group with these people ticked. */
async function addGroup(page: Page, name: string, people: Person[]) {
  await page.getByRole('button', { name: 'New group' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New approver group' })
  await dialog.getByLabel(/^Name/).fill(name)
  // One after another: clicks on the same list race each other.
  await people.reduce(
    (done, person) =>
      done.then(() => dialog.getByRole('checkbox', { name: new RegExp(person.name) }).check()),
    Promise.resolve(),
  )
  await dialog.getByRole('button', { name: 'Save group' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'Approver groups' }).getByText(name, { exact: true }),
  ).toBeVisible()
}

test('without an approval policy a draft is issued as before', async ({ api, page }) => {
  const id = await draft(api)
  expect((await approval(api, id)).required).toBe(false)
  const drawer = await openDrawer(page, id)
  const issue = drawer.getByRole('button', { name: 'Issue', exact: true })
  await expect(issue).toBeEnabled()
  await expect(drawer.getByRole('region', { name: 'Approval' })).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: 'Submit for approval' })).toHaveCount(0)
  await issue.click()
  await page
    .getByRole('dialog', { name: /^Issue this/ })
    .getByRole('button', { name: 'Issue' })
    .click()
  await expect.poll(async () => (await api.read(`/invoices/${id}`)).status).toBe('open')
  expect((await api.read(`/invoices/${id}`)).number).toEqual(expect.any(String))
})

test('groups and a policy set up in Settings: three other people approve, then the author issues', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  const anna = await join(api, browser, baseURL, 'Anna Accountant')
  const ben = await join(api, browser, baseURL, 'Ben Accountant')
  const maria = await join(api, browser, baseURL, 'Maria Manager')
  try {
    // Settings: two groups, then "Accountants at least 2 and Management at least 1" for invoices.
    await page.goto('/settings/approvals')
    const groups = page.getByRole('region', { name: 'Approver groups' })
    await addGroup(page, 'Accountants', [anna, ben])
    await addGroup(page, 'Management', [maria])
    // Members read in the team page's order.
    await expect(groups.getByText(/Anna Accountant/)).toContainText('Ben Accountant')

    const policy = page.getByRole('region', { name: 'Invoices', exact: true })
    await policy.getByRole('switch').click()
    const rules = policy.getByTestId('approval-rule')
    await expect(rules).toHaveCount(1)
    await rules
      .nth(0)
      .getByRole('button', { name: /^Who approves/ })
      .click()
    await page.getByRole('option', { name: /Accountants/ }).click()
    await rules.nth(0).getByLabel('at least').fill('2')
    await policy.getByRole('button', { name: 'Add rule' }).click()
    await expect(rules).toHaveCount(2)
    await expect(rules.nth(1).getByRole('button', { name: /^Who approves/ })).toContainText(
      'Management',
    )
    await expect(policy.getByRole('status', { name: 'Summary' })).toContainText(
      '2 people from Accountants and 1 from Management must approve.',
    )
    await policy.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Approval for Invoices saved')).toBeVisible()
    const saved = object(await api.read('/approvals/settings'))
    expect(saved.policies).toContainEqual(
      expect.objectContaining({
        doc_type: 'invoice',
        enabled: true,
        rules: [
          { group_id: expect.any(String), min: 2 },
          { group_id: expect.any(String), min: 1 },
        ],
      }),
    )

    // The author submits from the drawer: Submit takes Issue's place.
    const id = await draft(api)
    const client = text(object((await api.read(`/invoices/${id}`)).client).name)
    let drawer = await openDrawer(page, id)
    await drawer.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(drawer.getByText('Pending approval').first()).toBeVisible()
    const issue = drawer.getByRole('button', { name: 'Issue', exact: true })
    await expect(issue).toHaveAttribute('aria-disabled', 'true')
    // The author never approves their own document: no button, and the API refuses.
    await expect(drawer.getByRole('button', { name: 'Approve' })).toHaveCount(0)
    const own = await act(api, id, 'approve')
    expect(own.status()).toBe(403)
    expect(object(object(await own.json()).error).code).toBe('approval_not_allowed')

    // "Needs my approval": there for an approver, not for the author.
    await anna.page.goto('/invoices')
    const band = anna.page.getByRole('region', { name: 'Needs my approval' })
    await expect(band.getByText(client)).toBeVisible()
    await page.goto('/invoices')
    await expect(page.getByText(client).first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Needs my approval' })).toHaveCount(0)

    // Anna approves in her drawer, opened from the band.
    await band.getByRole('button', { name: new RegExp(client) }).click()
    const annaDrawer = anna.page.getByRole('dialog')
    const panel = annaDrawer.getByRole('region', { name: 'Approval' })
    await panel.getByRole('button', { name: 'Approve' }).click()
    await expect(panel.getByText('Anna Accountant approved')).toBeVisible()
    await expect(panel.getByTestId('approval-progress').first()).toContainText('1/2')
    await expect(panel.getByRole('button', { name: 'Approve' })).toHaveCount(0)

    // Ben's approval still leaves Management: issuing is refused until Maria's.
    await expect(await act(ben.api, id, 'approve')).toBeOK()
    const early = await api.write(`/invoices/${id}/issue`)
    expect(early.status()).toBe(409)
    expect(object(object(await early.json()).error).code).toBe('approval_required')
    drawer = await openDrawer(page, id)
    await expect(drawer.getByRole('button', { name: 'Issue', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(await act(maria.api, id, 'approve')).toBeOK()
    expect((await approval(api, id)).state).toBe('approved')

    // Approved: the author issues it and it gets its number.
    drawer = await openDrawer(page, id)
    await expect(drawer.getByText('Approved. It’s ready to issue.')).toBeVisible()
    const ready = drawer.getByRole('button', { name: 'Issue', exact: true })
    await expect(ready).toBeEnabled()
    await expect(ready).not.toHaveAttribute('aria-disabled')
    await ready.click()
    await page
      .getByRole('dialog', { name: /^Issue this/ })
      .getByRole('button', { name: 'Issue' })
      .click()
    await expect.poll(async () => (await api.read(`/invoices/${id}`)).status).toBe('open')
    const issued = await api.read(`/invoices/${id}`)
    expect(issued.number).toEqual(expect.any(String))
    await expect(page.getByRole('dialog').getByText(text(issued.number)).first()).toBeVisible()
  } finally {
    await Promise.all([anna, ben, maria].map((person) => person.context.close()))
  }
})

test('a rejection sends the draft back to its author with the reason, ready to edit and submit again', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  const maria = await join(api, browser, baseURL, 'Maria Manager')
  try {
    await setUp(api, [maria.id])
    const id = await draft(api)
    await expect(await act(api, id, '')).toBeOK()

    // Maria asks for changes in her drawer; the comment is required.
    const drawer = await openDrawer(maria.page, id)
    const panel = drawer.getByRole('region', { name: 'Approval' })
    await panel.getByRole('button', { name: 'Request changes' }).click()
    const dialog = maria.page.getByRole('dialog', { name: 'Request changes' })
    await dialog.getByRole('button', { name: 'Send back' }).click()
    await expect(dialog.getByText('Say what needs to change.')).toBeVisible()
    await dialog.getByLabel(/What needs to change/).fill('The rate should be 90, not 100.')
    await dialog.getByRole('button', { name: 'Send back' }).click()
    await expect(panel.getByText('Maria Manager asked for changes')).toBeVisible()

    const rejected = await approval(api, id)
    expect(rejected.state).toBe('rejected')
    expect(rejected.comment).toBe('The rate should be 90, not 100.')
    expect((await api.read(`/invoices/${id}`)).approval_state).toBe('rejected')

    // The author reads why, can edit it and submit again; Issue still waits.
    const own = await openDrawer(page, id)
    const ownPanel = own.getByRole('region', { name: 'Approval' })
    await expect(ownPanel.getByText('Changes requested by Maria Manager')).toBeVisible()
    await expect(ownPanel.getByTestId('approval-reason')).toHaveText(
      'The rate should be 90, not 100.',
    )
    await expect(own.getByText('Changes requested').first()).toBeVisible()
    await expect(own.getByRole('link', { name: 'Edit' })).toBeVisible()
    await expect(own.getByRole('button', { name: 'Submit for approval' })).toBeVisible()
    expect((await api.write(`/invoices/${id}/issue`)).status()).toBe(409)
  } finally {
    await maria.context.close()
  }
})

test('editing an approved draft ends its approval: it must be submitted again before it issues', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  const maria = await join(api, browser, baseURL, 'Maria Manager')
  try {
    await setUp(api, null)
    const id = await draft(api)
    await expect(await act(api, id, '')).toBeOK()
    await expect(await act(maria.api, id, 'approve')).toBeOK()
    expect((await approval(api, id)).state).toBe('approved')

    await api.save(`/invoices/${id}`, { reference: 'PO-4711' }, 'PATCH')
    const reset = await approval(api, id)
    expect(reset.state).toBe('none')
    expect(reset.can_submit).toBe(true)
    expect(reset.trail).toContainEqual(expect.objectContaining({ kind: 'reset' }))
    const refused = await api.write(`/invoices/${id}/issue`)
    expect(refused.status()).toBe(409)
    expect(object(object(await refused.json()).error).code).toBe('approval_required')

    const drawer = await openDrawer(page, id)
    await expect(drawer.getByRole('button', { name: 'Submit for approval' })).toBeVisible()
    await expect(
      drawer.getByRole('region', { name: 'Approval' }).getByText(/approval starts again/),
    ).toBeVisible()
  } finally {
    await maria.context.close()
  }
})
