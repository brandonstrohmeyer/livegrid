import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  admin,
  db,
  clearFirestore,
  createUser,
  signInUser,
  callFunction,
  callHosting,
  projectId
} from './helpers.js'

describe('functions emulator', () => {
  beforeAll(async () => {
    process.env.GCLOUD_PROJECT = projectId
  })

  beforeEach(async () => {
    await clearFirestore()
  })

  it('serves cached events via hosting rewrite', async () => {
    const seedResp = await callFunction('testSeedEventCache', {
      body: {
        source: 'nasa',
        eventId: 'event-1',
        title: 'Test Event',
        startDateIso: '2026-01-01T00:00:00Z',
        endDateIso: '2026-01-02T00:00:00Z'
      }
    })
    expect(seedResp.ok).toBe(true)

    const directResp = await callFunction('cachedEvents', { method: 'GET' })
    expect(directResp.ok).toBe(true)
    const directPayload = await directResp.json()
    expect(directPayload.count).toBeGreaterThan(0)
    expect(directPayload.events[0].source).toBe('nasa')

    const response = await callHosting('/api/cached-events')
    expect(response.ok).toBe(true)
    const payload = await response.json()
    expect(Array.isArray(payload.events)).toBe(true)
  })

  it('creates admin-managed persistent events in the shared cache', async () => {
    const password = 'secret123'
    const auth = await createUser({ email: 'admin-events@example.com', password })
    await admin.auth().setCustomUserClaims(auth.localId, { livegridAdmin: true })
    const adminAuth = await signInUser({ email: 'admin-events@example.com', password })

    const unauthorized = await callFunction('adminEvents', {
      body: {
        title: 'Rejected Event',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/REJECTED_SHEET_ID/edit',
        startDate: '2026-05-01',
        endDate: '2026-05-02'
      }
    })
    expect(unauthorized.status).toBe(401)

    const nonAdminAuth = await createUser({ email: 'not-admin-events@example.com', password })
    const forbidden = await callFunction('adminEvents', {
      method: 'GET',
      idToken: nonAdminAuth.idToken
    })
    expect(forbidden.status).toBe(403)

    const accessResp = await callFunction('adminEvents', {
      method: 'GET',
      idToken: adminAuth.idToken
    })
    expect(accessResp.ok).toBe(true)
    await expect(accessResp.json()).resolves.toMatchObject({ admin: true })

    const createResp = await callFunction('adminEvents', {
      body: {
        title: 'Manual Track Weekend',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/MANUAL_SHEET_ID/edit#gid=123',
        startDate: '2026-05-01',
        endDate: '2026-05-02'
      },
      idToken: adminAuth.idToken
    })
    expect(createResp.ok).toBe(true)
    const createPayload = await createResp.json()
    expect(createPayload.event).toMatchObject({
      source: 'manual',
      title: 'Manual Track Weekend',
      spreadsheetId: 'MANUAL_SHEET_ID',
      label: '[CUSTOM] Manual Track Weekend',
      startDateKey: '2026-05-01',
      endDateKey: '2026-05-02',
      dateSource: 'admin',
      dateResolved: true
    })

    const cachedResp = await callFunction('cachedEvents', { method: 'GET' })
    expect(cachedResp.ok).toBe(true)
    const cachedPayload = await cachedResp.json()
    const cachedEvent = cachedPayload.events.find(event => event.id === createPayload.event.id)
    expect(cachedEvent).toMatchObject({
      source: 'manual',
      title: 'Manual Track Weekend',
      sheetUrl: 'https://docs.google.com/spreadsheets/d/MANUAL_SHEET_ID/edit#gid=123',
      startDateKey: '2026-05-01',
      endDateKey: '2026-05-02'
    })

    const deleteResp = await callFunction('adminEvents', {
      method: 'DELETE',
      body: { id: createPayload.event.id },
      idToken: adminAuth.idToken
    })
    expect(deleteResp.ok).toBe(true)
    await expect(deleteResp.json()).resolves.toMatchObject({
      status: 'deleted',
      id: createPayload.event.id
    })

    const cachedAfterDeleteResp = await callFunction('cachedEvents', { method: 'GET' })
    expect(cachedAfterDeleteResp.ok).toBe(true)
    const cachedAfterDeletePayload = await cachedAfterDeleteResp.json()
    const deletedEvent = cachedAfterDeletePayload.events.find(event => event.id === createPayload.event.id)
    expect(deletedEvent).toBeUndefined()
  })

  it('registers and unregisters push tokens', async () => {
    const auth = await createUser({ email: 'token-test@example.com', password: 'secret123' })
    const token = 'token-ok'

    const registerResp = await callFunction('registerPushToken', {
      body: { token, platform: 'desktop', timezone: 'UTC' },
      idToken: auth.idToken
    })
    expect(registerResp.ok).toBe(true)

    const tokenDoc = await db.collection('notificationTokens').doc(token).get()
    expect(tokenDoc.exists).toBe(true)
    const userDoc = await db.collection('users').doc(auth.localId).get()
    expect(userDoc.exists).toBe(true)
    expect(userDoc.data()?.tokens || []).toContain(token)

    const unregisterResp = await callFunction('unregisterPushToken', {
      body: { token },
      idToken: auth.idToken
    })
    expect(unregisterResp.ok).toBe(true)

    const tokenDocAfter = await db.collection('notificationTokens').doc(token).get()
    expect(tokenDocAfter.exists).toBe(false)
  })

  it('sends push notifications (stubbed messaging)', async () => {
    const auth = await createUser({ email: 'push-test@example.com', password: 'secret123' })
    const response = await callFunction('sendPushNotification', {
      body: {
        token: 'token-ok',
        title: 'Test',
        body: 'Hello',
        data: { reason: 'test' }
      },
      idToken: auth.idToken
    })
    expect(response.ok).toBe(true)
    const payload = await response.json()
    expect(payload.status).toBe('sent')
  })

  it('accepts client telemetry and stores visitor state', async () => {
    const response = await callFunction('clientTelemetry', {
      body: {
        event: 'visitor.opened',
        severity: 'info',
        path: '/',
        appVersion: '0.0.0-test',
        fingerprint: 'visitor-opened:/',
        visitorId: 'visitor-1',
        sessionId: 'session-1',
        interactionType: 'opened',
        meta: {
          authState: 'anonymous',
          source: 'nasa'
        }
      }
    })

    expect(response.status).toBe(204)

    const snapshot = await db.collection('visitorTelemetry').get()
    expect(snapshot.size).toBe(1)
    const payload = snapshot.docs[0].data()
    expect(payload.lastAuthState).toBe('anonymous')
    expect(payload.lastOpenedAt).toBeTruthy()
    expect(payload.lastInteractionAt).toBeTruthy()
  })

  it('rejects malformed client telemetry payloads', async () => {
    const response = await callFunction('clientTelemetry', {
      body: {
        event: 'unknown.event',
        severity: 'warn'
      }
    })

    expect(response.status).toBe(400)
  })

  it('serves the health endpoint via hosting rewrite', async () => {
    const response = await callHosting('/api/health')
    expect([200, 503]).toContain(response.status)
    const payload = await response.json()
    expect(payload.checks).toBeTruthy()
    expect(payload.checks.firebaseAdmin.status).toBe('ok')
    expect(payload.checks.auth.status).toBe('ok')
    expect(payload.checks.sheetsProbe.status).toBe('ok')
  })

  it('handles sheets API endpoints using fixtures', async () => {
    const resolveResp = await callFunction('sheetsApi/sheets/resolve', {
      body: { url: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit' }
    })
    expect(resolveResp.ok).toBe(true)
    const resolvePayload = await resolveResp.json()
    expect(resolvePayload.spreadsheetId).toBe('TEST_SHEET_ID')

    const resolveEventResp = await callFunction('sheetsApi/sheets/resolve-event', {
      body: {
        url: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit',
        source: 'hod'
      }
    })
    expect(resolveEventResp.ok).toBe(true)
    const resolveEventPayload = await resolveEventResp.json()
    expect(resolveEventPayload.event).toMatchObject({
      source: 'hod',
      title: 'Test Schedule Sheet',
      spreadsheetId: 'TEST_SHEET_ID',
      dateResolved: false
    })
    expect(resolveEventPayload.event.id).toMatch(/^hod:hod-/)

    const tabsResp = await callFunction('sheetsApi/sheets/TEST_SHEET_ID/tabs', { method: 'GET' })
    expect(tabsResp.ok).toBe(true)
    const tabsPayload = await tabsResp.json()
    expect(tabsPayload.tabs.length).toBeGreaterThan(0)

    const tabResp = await callFunction('sheetsApi/sheets/TEST_SHEET_ID/tab/123', { method: 'GET' })
    expect(tabResp.ok).toBe(true)
    const tabPayload = await tabResp.json()
    expect(tabPayload.rows.length).toBeGreaterThan(0)
  })

  it('syncs scheduled notifications via callable', async () => {
    const auth = await createUser({ email: 'sync-test@example.com', password: 'secret123' })
    const fireAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const sessionStart = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const response = await callFunction('syncScheduledNotifications', {
      body: {
        data: {
          eventId: 'event-1',
          desiredNotifications: [
            {
              runGroupId: 'HPDE 1',
              sessionStartIsoUtc: sessionStart,
              offsetMinutes: 10,
              fireAtIsoUtc: fireAt,
              payload: {
                title: 'Upcoming session',
                body: 'HPDE 1 starts soon',
                data: { eventId: 'event-1' }
              }
            }
          ]
        }
      },
      idToken: auth.idToken
    })
    expect(response.ok).toBe(true)
    const payload = await response.json()
    expect(payload.result?.status || payload.status).toBe('ok')

    const snap = await db.collection('scheduledNotifications').get()
    expect(snap.empty).toBe(false)
    const doc = snap.docs[0].data()
    expect(doc.status).toBe('pending')
    expect(doc.sessionStart?.toDate?.().toISOString()).toBe(sessionStart)
    expect(doc.offsetMinutes).toBe(10)
  })

  it('does not sync stale scheduled notifications after the session start', async () => {
    const auth = await createUser({ email: 'stale-sync-test@example.com', password: 'secret123' })
    const fireAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const sessionStart = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const response = await callFunction('syncScheduledNotifications', {
      body: {
        data: {
          eventId: 'event-stale-sync',
          desiredNotifications: [
            {
              runGroupId: 'HPDE 1',
              sessionStartIsoUtc: sessionStart,
              offsetMinutes: 10,
              fireAtIsoUtc: fireAt,
              payload: {
                title: 'Stale session',
                body: 'HPDE 1 already started',
                data: { eventId: 'event-stale-sync' }
              }
            }
          ]
        }
      },
      idToken: auth.idToken
    })
    expect(response.ok).toBe(true)
    const payload = await response.json()
    expect(payload.result?.count ?? payload.count).toBe(0)

    const snap = await db.collection('scheduledNotifications').where('eventId', '==', 'event-stale-sync').get()
    expect(snap.empty).toBe(true)
  })

  it('removes pending notifications when syncing an empty event payload', async () => {
    const auth = await createUser({ email: 'cleanup-test@example.com', password: 'secret123' })
    const fireAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
    const sessionStart = new Date(Date.now() + 30 * 60 * 1000).toISOString()

    const seedResp = await callFunction('syncScheduledNotifications', {
      body: {
        data: {
          eventId: 'event-cleanup',
          desiredNotifications: [
            {
              runGroupId: 'HPDE 1',
              sessionStartIsoUtc: sessionStart,
              offsetMinutes: 10,
              fireAtIsoUtc: fireAt,
              payload: {
                title: 'Upcoming session',
                body: 'HPDE 1 starts soon',
                data: { eventId: 'event-cleanup' }
              }
            }
          ]
        }
      },
      idToken: auth.idToken
    })
    expect(seedResp.ok).toBe(true)

    let snap = await db.collection('scheduledNotifications').where('eventId', '==', 'event-cleanup').get()
    expect(snap.empty).toBe(false)

    const cleanupResp = await callFunction('syncScheduledNotifications', {
      body: {
        data: {
          eventId: 'event-cleanup',
          desiredNotifications: []
        }
      },
      idToken: auth.idToken
    })
    expect(cleanupResp.ok).toBe(true)

    snap = await db.collection('scheduledNotifications').where('eventId', '==', 'event-cleanup').get()
    expect(snap.empty).toBe(true)
  })
})
