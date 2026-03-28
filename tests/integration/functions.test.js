import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  db,
  clearFirestore,
  createUser,
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
  })

  it('handles sheets API endpoints using fixtures', async () => {
    const resolveResp = await callFunction('sheetsApi/sheets/resolve', {
      body: { url: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit' }
    })
    expect(resolveResp.ok).toBe(true)
    const resolvePayload = await resolveResp.json()
    expect(resolvePayload.spreadsheetId).toBe('TEST_SHEET_ID')

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
  })
})
