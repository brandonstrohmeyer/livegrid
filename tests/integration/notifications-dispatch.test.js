import { describe, it, expect, beforeEach } from 'vitest'
import { admin, db, clearFirestore, createUser, callFunction } from './helpers.js'

async function seedUserWithTokens({ email, tokens }) {
  const auth = await createUser({ email, password: 'secret123' })
  const uid = auth.localId
  await db.collection('users').doc(uid).set({ tokens })
  if (tokens.length) {
    const batch = db.batch()
    tokens.forEach(token => {
      batch.set(db.collection('notificationTokens').doc(token), {
        uid,
        platform: 'desktop',
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
      })
    })
    await batch.commit()
  }
  return { uid, auth }
}

describe('scheduled notification dispatcher', () => {
  beforeEach(async () => {
    await clearFirestore()
  })

  it('updates notification status based on delivery results', async () => {
    const users = [
      { email: 'ok@example.com', token: 'token-ok' },
      { email: 'invalid@example.com', token: 'token-invalid' },
      { email: 'transient@example.com', token: 'token-transient' }
    ]

    const authUsers = []
    for (const entry of users) {
      const auth = await createUser({ email: entry.email, password: 'secret123' })
      authUsers.push({ ...entry, auth })
      const registerResp = await callFunction('registerPushToken', {
        body: { token: entry.token, platform: 'desktop', timezone: 'UTC' },
        idToken: auth.idToken
      })
      expect(registerResp.ok).toBe(true)
    }

    const fireAt = new Date(Date.now() - 60 * 1000).toISOString()
    const sessionStart = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    for (const entry of authUsers) {
      const syncResp = await callFunction('syncScheduledNotifications', {
        body: {
          data: {
            eventId: 'event-1',
            desiredNotifications: [
              {
                runGroupId: 'HPDE 1',
                sessionStartIsoUtc: sessionStart,
                offsetMinutes: 5,
                fireAtIsoUtc: fireAt,
                payload: { title: 'Test', body: 'Hello', data: {} }
              }
            ]
          }
        },
        idToken: entry.auth.idToken
      })
      expect(syncResp.ok).toBe(true)
    }

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const snapshot = await db.collection('scheduledNotifications').get()
    const statuses = snapshot.docs.map(doc => doc.data().status)

    expect(statuses).toContain('sent')
    expect(statuses).toContain('undeliverable')
    expect(statuses).toContain('pending')
  })

  it('marks notifications undeliverable when user doc is missing', async () => {
    const uid = 'missing-user'
    const fireAt = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('missing-user-doc').set({
      uid,
      status: 'pending',
      leaseUntil: null,
      fireAt,
      payload: { title: 'Missing user', body: 'No user doc', data: {} },
      dedupeKey: 'missing-user-doc',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('missing-user-doc').get()
    expect(doc.data()?.status).toBe('undeliverable')
    expect(doc.data()?.undeliverableReason).toBe('missing_user_doc')
  })

  it('marks notifications undeliverable when user has no tokens', async () => {
    const { uid } = await seedUserWithTokens({ email: 'no-tokens@example.com', tokens: [] })
    const fireAt = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('no-tokens').set({
      uid,
      status: 'pending',
      leaseUntil: null,
      fireAt,
      payload: { title: 'No tokens', body: 'User has no tokens', data: {} },
      dedupeKey: 'no-tokens',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('no-tokens').get()
    expect(doc.data()?.status).toBe('undeliverable')
    expect(doc.data()?.undeliverableReason).toBe('no_tokens')
  })

  it('removes invalid tokens and marks notification partial on mixed outcomes', async () => {
    const tokens = ['token-ok', 'token-invalid']
    const { uid } = await seedUserWithTokens({ email: 'mixed-outcomes@example.com', tokens })
    const fireAt = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('mixed-outcomes').set({
      uid,
      status: 'pending',
      leaseUntil: null,
      fireAt,
      payload: { title: 'Mixed', body: 'Ok + invalid', data: {} },
      dedupeKey: 'mixed-outcomes',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('mixed-outcomes').get()
    expect(doc.data()?.status).toBe('partial')

    const userDoc = await db.collection('users').doc(uid).get()
    const updatedTokens = userDoc.data()?.tokens || []
    expect(updatedTokens).toContain('token-ok')
    expect(updatedTokens).not.toContain('token-invalid')
  })

  it('requeues transient failures with a retry', async () => {
    const tokens = ['token-transient']
    const { uid } = await seedUserWithTokens({ email: 'transient-only@example.com', tokens })
    const originalFireAt = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('transient-only').set({
      uid,
      status: 'pending',
      leaseUntil: null,
      fireAt: originalFireAt,
      payload: { title: 'Transient', body: 'Retry expected', data: {} },
      dedupeKey: 'transient-only',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('transient-only').get()
    expect(doc.data()?.status).toBe('pending')
    expect(doc.data()?.retryCount).toBe(1)
    expect(doc.data()?.fireAt?.toMillis?.()).toBeGreaterThan(originalFireAt.toMillis())
  })

  it('marks notifications undeliverable when all tokens are invalid', async () => {
    const tokens = ['token-invalid']
    const { uid } = await seedUserWithTokens({ email: 'invalid-only@example.com', tokens })
    const fireAt = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('invalid-only').set({
      uid,
      status: 'pending',
      leaseUntil: null,
      fireAt,
      payload: { title: 'Invalid', body: 'All invalid', data: {} },
      dedupeKey: 'invalid-only',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('invalid-only').get()
    expect(doc.data()?.status).toBe('undeliverable')
    expect(doc.data()?.undeliverableReason).toBe('invalid_tokens')
  })

  it('marks notifications undeliverable when all tokens fail non-transiently', async () => {
    const tokens = ['token-fail']
    const { uid } = await seedUserWithTokens({ email: 'fail-only@example.com', tokens })
    const fireAt = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('fail-only').set({
      uid,
      status: 'pending',
      leaseUntil: null,
      fireAt,
      payload: { title: 'Fail', body: 'All fail', data: {} },
      dedupeKey: 'fail-only',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('fail-only').get()
    expect(doc.data()?.status).toBe('undeliverable')
    expect(doc.data()?.undeliverableReason).toBe('all_failed')
  })

  it('retries notifications stuck in sending after lease expiry', async () => {
    const auth = await createUser({ email: 'lease-expired@example.com', password: 'secret123' })
    const uid = auth.localId
    const token = 'token-ok'

    await db.collection('users').doc(uid).set({ tokens: [token] })
    await db.collection('notificationTokens').doc(token).set({
      uid,
      platform: 'desktop',
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const nowMs = Date.now()
    const fireAt = admin.firestore.Timestamp.fromMillis(nowMs - 10 * 60 * 1000)
    const leaseUntil = admin.firestore.Timestamp.fromMillis(nowMs - 2 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('stuck-lease').set({
      uid,
      status: 'sending',
      leaseUntil,
      fireAt,
      payload: { title: 'Lease expired', body: 'Retry me', data: {} },
      dedupeKey: 'stuck-lease',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('stuck-lease').get()
    // Expected: expired leases are retried and delivered.
    expect(doc.data()?.status).toBe('sent')
  })

  it('processes notifications missing status field', async () => {
    const auth = await createUser({ email: 'missing-status@example.com', password: 'secret123' })
    const uid = auth.localId
    const token = 'token-ok'

    await db.collection('users').doc(uid).set({ tokens: [token] })
    await db.collection('notificationTokens').doc(token).set({
      uid,
      platform: 'desktop',
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const fireAt = admin.firestore.Timestamp.fromMillis(Date.now() - 5 * 60 * 1000)

    await db.collection('scheduledNotifications').doc('missing-status').set({
      uid,
      leaseUntil: null,
      fireAt,
      payload: { title: 'Missing status', body: 'Heal me', data: {} },
      dedupeKey: 'missing-status',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('missing-status').get()
    // Expected: missing status records are treated as pending and delivered.
    expect(doc.data()?.status).toBe('sent')
  })

  it('does not starve unleased notifications behind leased pending records', async () => {
    const auth = await createUser({ email: 'leased-starvation@example.com', password: 'secret123' })
    const uid = auth.localId
    const token = 'token-ok'

    await db.collection('users').doc(uid).set({ tokens: [token] })
    await db.collection('notificationTokens').doc(token).set({
      uid,
      platform: 'desktop',
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const nowMs = Date.now()
    const leasedFireAt = admin.firestore.Timestamp.fromMillis(nowMs - 15 * 60 * 1000)
    const activeLease = admin.firestore.Timestamp.fromMillis(nowMs + 10 * 60 * 1000)

    // Create enough leased pending docs to fill the dispatcher batch.
    const leasedCount = 601
    const batch = db.batch()
    for (let i = 0; i < leasedCount; i += 1) {
      const ref = db.collection('scheduledNotifications').doc(`leased-${i}`)
      batch.set(ref, {
        uid,
        status: 'pending',
        leaseUntil: activeLease,
        fireAt: leasedFireAt,
        payload: { title: 'Leased', body: 'Skip me', data: {} },
        dedupeKey: `leased-${i}`,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      })
    }
    await batch.commit()

    const targetFireAt = admin.firestore.Timestamp.fromMillis(nowMs - 5 * 60 * 1000)
    await db.collection('scheduledNotifications').doc('target-unleased').set({
      uid,
      status: 'pending',
      leaseUntil: null,
      fireAt: targetFireAt,
      payload: { title: 'Target', body: 'Do not starve', data: {} },
      dedupeKey: 'target-unleased',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    })

    const dispatchResp = await callFunction('testDispatchScheduledNotifications', { method: 'POST' })
    expect(dispatchResp.ok).toBe(true)

    const doc = await db.collection('scheduledNotifications').doc('target-unleased').get()
    // Expected: dispatcher paginates / skips leased docs to reach unleased pending work.
    expect(doc.data()?.status).toBe('sent')
  })
})
