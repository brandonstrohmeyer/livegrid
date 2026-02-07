import * as admin from 'firebase-admin'
// Use explicit Firestore exports to avoid admin.firestore.FieldValue being undefined in the emulator runtime.
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { onRequest, onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { createHash } from 'crypto'

admin.initializeApp()

const db = admin.firestore()
const messaging = admin.messaging()

const defaultHost = process.env.GCLOUD_PROJECT ? `https://${process.env.GCLOUD_PROJECT}.web.app` : 'https://livegrid.stro.io'
const appPublicUrl = process.env.APP_PUBLIC_URL || defaultHost

const scheduledCollection = db.collection('scheduledNotifications')
const usersCollection = db.collection('users')
const sheetMetadataCollection = db.collection('sheetMetadata')
const sheetSourcesCollection = db.collection('sheetSources')

const SCHEDULER_REGION = 'us-central1'
const LEASE_MS = 2 * 60 * 1000
const DISPATCH_LIMIT = 200

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || process.env.SHEETS_API_KEY || ''
const SHEETS_METADATA_TTL_MS = 15 * 60 * 1000
const SHEETS_VALUES_TTL_MS = 30 * 1000
const SHEETS_DEFAULT_RANGE_END = 'Z'
const SHEETS_WIDE_RANGE_END = 'AZ'
const SHEETS_RATE_LIMIT_WINDOW_MS = 60 * 1000
const SHEETS_RATE_LIMIT_MAX = 60
const HOD_MA_ORG_URL = 'https://www.motorsportreg.com/orgs/hooked-on-driving/mid-atlantic'
const HOD_MA_EVENT_LIMIT = 20
const HOD_MA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

type SheetTab = {
  sheetId: number
  title: string
}

type SheetMetadata = {
  spreadsheetId: string
  spreadsheetTitle: string | null
  tabs: SheetTab[]
  fetchedAt: number
}

type SheetValues = {
  spreadsheetId: string
  spreadsheetTitle: string | null
  sheetId: number
  sheetTitle: string
  headers: string[]
  rows: string[][]
  fetchedAt: number
  contentHash: string
}

type CacheEntry<T> = {
  value: T
  expiresAt: number
}

const sheetMetadataCache = new Map<string, CacheEntry<SheetMetadata>>()
const sheetValuesCache = new Map<string, CacheEntry<SheetValues>>()
const sheetMetadataInFlight = new Map<string, Promise<SheetMetadata>>()
const sheetValuesInFlight = new Map<string, Promise<SheetValues>>()
const sheetRateLimit = new Map<string, { count: number; resetAt: number }>()

async function authenticate(req: { get: (name: string) => string | undefined }) {
  const authHeader = req.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.substring(7)
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    return decoded.uid
  } catch (err: any) {
    console.warn('[functions] Failed to verify auth token', err?.message || err)
    return null
  }
}

function sanitizeData(payload: Record<string, unknown> = {}) {
  return Object.entries(payload).reduce<Record<string, string>>((acc, [key, value]) => {
    if (value === undefined || value === null) return acc
    acc[key] = typeof value === 'string' ? value : JSON.stringify(value)
    return acc
  }, {})
}

function tokenFingerprint(token?: string) {
  if (!token) return null
  try {
    return createHash('sha256').update(token).digest('hex').slice(0, 12)
  } catch (err) {
    console.warn('[functions] Failed to hash token for logging', err)
    return 'hash_error'
  }
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
}

function extractEventLinksFromOrg(html: string) {
  const links = new Set<string>()
  const hrefRegex = /href=["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = hrefRegex.exec(html))) {
    const rawHref = match[1] || ''
    if (!rawHref.includes('/events/')) continue
    const url = new URL(rawHref, 'https://www.motorsportreg.com')
    if (!/\/events\/[^/]+-\d{5,}\/?$/.test(url.pathname)) continue
    links.add(`https://www.motorsportreg.com${url.pathname}`)
  }
  return Array.from(links)
}

function extractSheetUrlFromHtml(html: string) {
  const match = html.match(/https?:\/\/docs\.google\.com\/spreadsheets\/[^\s"'<>]+/i)
  if (!match) return null
  return decodeHtmlEntities(match[0])
}

function titleFromEventUrl(eventUrl: string) {
  try {
    const url = new URL(eventUrl)
    const parts = url.pathname.split('/events/')
    const slug = parts[1] || ''
    const cleaned = slug.replace(/-\d{5,}\/?$/, '').replace(/[-_]+/g, ' ').trim()
    if (!cleaned) return 'Event'
    return cleaned
      .split(' ')
      .map(word => (word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ')
  } catch (err) {
    return 'Event'
  }
}

function extractEventTitle(html: string, fallbackUrl: string) {
  const ogMatch = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
  if (ogMatch?.[1]) return decodeHtmlEntities(ogMatch[1]).trim()

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch?.[1]) return decodeHtmlEntities(titleMatch[1]).trim()

  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
  if (h1Match?.[1]) return decodeHtmlEntities(h1Match[1]).trim()

  return titleFromEventUrl(fallbackUrl)
}

function buildRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function buildNotifId({
  uid,
  eventId,
  runGroupId,
  sessionStartIsoUtc,
  offsetMinutes
}: {
  uid: string
  eventId: string
  runGroupId: string
  sessionStartIsoUtc: string
  offsetMinutes: number
}) {
  const raw = `${uid}|${eventId}|${runGroupId}|${sessionStartIsoUtc}|${offsetMinutes}`
  return createHash('sha256').update(raw).digest('hex')
}

function parseTimestamp(isoUtc: string) {
  const date = new Date(isoUtc)
  if (Number.isNaN(date.getTime())) return null
  // Timestamp from firebase-admin/firestore avoids the emulator crash seen with admin.firestore.Timestamp.
  return Timestamp.fromDate(date)
}

function isTransientMessagingError(code?: string) {
  return code === 'messaging/internal-error' || code === 'messaging/server-unavailable'
}

function isInvalidTokenError(code?: string) {
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token'
}

function buildMessage({ tokenList, title, body, data, tag }: {
  tokenList: string[]
  title: string
  body: string
  data: Record<string, unknown>
  tag?: string
}): admin.messaging.MulticastMessage {
  const sanitized = sanitizeData(data)
  if (tag) sanitized.tag = tag

  return {
    tokens: tokenList,
    notification: { title, body },
    data: sanitized,
    android: {
      priority: 'high' as const
    },
    apns: {
      payload: {
        aps: {
          sound: 'default'
        }
      }
    },
    webpush: {
      headers: {
        Urgency: 'high',
        TTL: '900'
      },
      notification: {
        icon: `${appPublicUrl}/livegrid-icon.png`,
        badge: `${appPublicUrl}/livegrid-icon-maskable.png`,
        vibrate: [120, 50, 120],
        tag: tag || undefined,
        requireInteraction: false
      },
      fcmOptions: {
        link: appPublicUrl
      }
    }
  }
}

// Simple proxy for the NASA-SE RSS feed so the frontend can avoid CORS issues.
export const nasaFeed = onRequest({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed')
    return
  }

  try {
    const upstream = await fetch('https://nasa-se.com/feed/')
    if (!upstream.ok) {
      console.error('Upstream feed error', upstream.status, upstream.statusText)
      res.status(502).send('Failed to fetch upstream feed')
      return
    }

    const body = await upstream.text()
    const contentType = upstream.headers.get('content-type') || 'application/rss+xml; charset=utf-8'
    res.set('Content-Type', contentType)
    res.status(200).send(body)
  } catch (err) {
    console.error('Error proxying nasa-se feed', err)
    res.status(500).send('Error fetching feed')
  }
})

export const hodMaEvents = onRequest({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed')
    return
  }

  try {
    const upstream = await fetch(HOD_MA_ORG_URL, {
      headers: {
        'User-Agent': HOD_MA_USER_AGENT
      }
    })
    if (!upstream.ok) {
      console.error('Upstream HOD-MA org error', upstream.status, upstream.statusText)
      res.status(502).json({ error: 'Failed to fetch upstream events' })
      return
    }

    const body = await upstream.text()
    const eventLinks = extractEventLinksFromOrg(body).slice(0, HOD_MA_EVENT_LIMIT)
    const events = []

    for (const eventUrl of eventLinks) {
      try {
        const eventResp = await fetch(eventUrl, {
          headers: { 'User-Agent': HOD_MA_USER_AGENT }
        })
        if (!eventResp.ok) continue
        const eventHtml = await eventResp.text()
        const sheetUrl = extractSheetUrlFromHtml(eventHtml)
        if (!sheetUrl) continue

        const title = extractEventTitle(eventHtml, eventUrl)
        const idMatch = eventUrl.match(/-(\d{5,})(?:\/)?$/)
        const eventId: string = idMatch && idMatch[1]
          ? `hod-${idMatch[1]}`
          : `hod-${events.length + 1}`
        events.push({
          id: eventId,
          title,
          sheetUrl,
          eventUrl
        })
      } catch (err) {
        console.warn('Failed to inspect HOD-MA event', eventUrl, err)
      }
    }

    res.status(200).json({ events })
  } catch (err) {
    console.error('Error fetching HOD-MA events', err)
    res.status(500).json({ error: 'Error fetching events' })
  }
})

export const registerPushToken = onRequest({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const { token, platform = 'unknown', timezone = null, appVersion = null, clientInfo = null } = req.body || {}
  if (!token) {
    res.status(400).json({ error: 'token is required' })
    return
  }

  const uid = await authenticate(req)
  const tokenHash = tokenFingerprint(token)
  const clientSummary = clientInfo ? {
    os: clientInfo.os || null,
    browser: clientInfo.browser || null,
    deviceClass: clientInfo.deviceClass || null,
    isStandalone: clientInfo.isStandalone ?? null,
    displayMode: clientInfo.displayMode || null
  } : null
  console.log('[registerPushToken] Request', {
    uid: uid || null,
    tokenHash,
    platform,
    timezone,
    appVersion,
    client: clientSummary
  })

  try {
    await db.collection('notificationTokens').doc(token).set({
      uid: uid || null,
      platform,
      clientInfo: clientInfo || null,
      timezone,
      appVersion,
      lastSeenAt: FieldValue.serverTimestamp()
    }, { merge: true })

    if (uid) {
      await usersCollection.doc(uid).set({
        tokens: FieldValue.arrayUnion(token),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
      console.log('[registerPushToken] Linked token to user doc', { uid, tokenHash })
    } else {
      console.warn('[registerPushToken] Missing auth uid; token not linked to user doc', { tokenHash })
    }

    console.log('[registerPushToken] Stored token', { uid: uid || null, tokenHash })
    res.json({ status: 'registered' })
  } catch (err) {
    console.error('Failed to store push token', err)
    res.status(500).json({ error: 'Failed to store token' })
  }
})

export const unregisterPushToken = onRequest({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const { token } = req.body || {}
  if (!token) {
    res.status(400).json({ error: 'token is required' })
    return
  }

  const uid = await authenticate(req)
  const tokenHash = tokenFingerprint(token)
  console.log('[unregisterPushToken] Request', { uid: uid || null, tokenHash })

  try {
    await db.collection('notificationTokens').doc(token).delete()

    if (uid) {
      await usersCollection.doc(uid).set({
        tokens: FieldValue.arrayRemove(token),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
    }

    console.log('[unregisterPushToken] Deleted token', { uid: uid || null, tokenHash })
    res.json({ status: 'deleted' })
  } catch (err) {
    console.error('Failed to delete push token', err)
    res.status(500).json({ error: 'Failed to delete token' })
  }
})

export const sendPushNotification = onRequest({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const uid = await authenticate(req)

  const { token, title, body, data = {}, tag = undefined } = req.body || {}
  if (!token || !title || !body) {
    res.status(400).json({ error: 'token, title, and body are required' })
    return
  }

  const message = buildMessage({
    tokenList: [token],
    title,
    body,
    data,
    tag
  })

  try {
    const response = await messaging.sendEachForMulticast(message)
    console.log('[sendPushNotification] FCM response:', response)
    res.json({ status: 'sent', id: response?.responses?.[0]?.messageId || null, requestedBy: uid || null })
  } catch (err: any) {
    console.error('Failed to send push message', err)
    if (err?.stack) console.error('Stack:', err.stack)
    res.status(500).json({ error: 'Failed to send push message', details: err?.message || err })
  }
})

type DesiredNotification = {
  runGroupId: string
  sessionStartIsoUtc: string
  offsetMinutes: number
  fireAtIsoUtc: string
  payload: {
    title: string
    body: string
    data: Record<string, unknown>
  }
}

export const syncScheduledNotifications = onCall({ region: SCHEDULER_REGION }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Authentication required')
  }

  const uid = request.auth.uid
  const { eventId, desiredNotifications } = request.data || {}
  console.log('[syncScheduledNotifications] Request', { uid, eventId, count: Array.isArray(desiredNotifications) ? desiredNotifications.length : 0 })
  if (!eventId || typeof eventId !== 'string') {
    throw new HttpsError('invalid-argument', 'eventId is required')
  }
  if (!Array.isArray(desiredNotifications)) {
    throw new HttpsError('invalid-argument', 'desiredNotifications must be an array')
  }

  const now = FieldValue.serverTimestamp()
  const desiredMap = new Map<string, DesiredNotification>()
  const notifIds: string[] = []
  const fireAtTimes: string[] = []

  for (const item of desiredNotifications as DesiredNotification[]) {
    if (!item?.runGroupId || !item?.sessionStartIsoUtc || !item?.fireAtIsoUtc || typeof item?.offsetMinutes !== 'number') {
      throw new HttpsError('invalid-argument', 'Each notification requires runGroupId, sessionStartIsoUtc, offsetMinutes, fireAtIsoUtc')
    }
    if (!item?.payload?.title || !item?.payload?.body) {
      throw new HttpsError('invalid-argument', 'Each notification requires payload.title and payload.body')
    }

    const notifId = buildNotifId({
      uid,
      eventId,
      runGroupId: item.runGroupId,
      sessionStartIsoUtc: item.sessionStartIsoUtc,
      offsetMinutes: item.offsetMinutes
    })
    desiredMap.set(notifId, item)
    notifIds.push(notifId)
    if (item?.fireAtIsoUtc) fireAtTimes.push(item.fireAtIsoUtc)
  }

  const docRefs = notifIds.map(id => scheduledCollection.doc(id))
  const existingDocs = docRefs.length ? await db.getAll(...docRefs) : []
  const existingById = new Map(existingDocs.map(doc => [doc.id, doc]))

  const batch = db.batch()

  desiredMap.forEach((item, notifId) => {
    const existing = existingById.get(notifId)
    const existingStatus = existing?.data()?.status
    if (existing?.exists && existingStatus === 'sent') {
      return
    }

    const fireAt = parseTimestamp(item.fireAtIsoUtc)
    if (!fireAt) {
      throw new HttpsError('invalid-argument', `Invalid fireAtIsoUtc for ${notifId}`)
    }

    const docRef = scheduledCollection.doc(notifId)
    const payload = {
      title: item.payload.title,
      body: item.payload.body,
      data: item.payload.data || {}
    }

    const base = {
      uid,
      eventId,
      runGroupId: item.runGroupId,
      fireAt,
      dedupeKey: notifId,
      payload,
      updatedAt: now
    }

    if (!existing?.exists) {
      batch.set(docRef, {
        ...base,
        status: 'pending',
        leaseUntil: null,
        createdAt: now,
        sentAt: null
      }, { merge: true })
    } else {
      const reset = existingStatus === 'undeliverable'
        ? {
            status: 'pending',
            leaseUntil: null,
            sentAt: null,
            undeliverableAt: null,
            undeliverableReason: null
          }
        : {}
      batch.set(docRef, { ...base, ...reset }, { merge: true })
    }
  })

  const pendingSnap = await scheduledCollection
    .where('uid', '==', uid)
    .where('eventId', '==', eventId)
    .where('status', '==', 'pending')
    .get()

  pendingSnap.forEach(doc => {
    if (!desiredMap.has(doc.id)) {
      batch.delete(doc.ref)
    }
  })

  await batch.commit()

  const sortedFireAt = fireAtTimes.filter(Boolean).sort()
  console.log('[syncScheduledNotifications] Synced', {
    uid,
    eventId,
    count: desiredMap.size,
    earliestFireAt: sortedFireAt[0] || null,
    latestFireAt: sortedFireAt[sortedFireAt.length - 1] || null
  })

  return { status: 'ok', count: desiredMap.size }
})

async function leaseNotification(docRef: FirebaseFirestore.DocumentReference, now: Timestamp) {
  let leased = false
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef)
    if (!snap.exists) return
    const data = snap.data() as any
    if (data.status !== 'pending') return
    if (data.leaseUntil && data.leaseUntil.toMillis() > now.toMillis()) return
    tx.update(docRef, {
      status: 'sending',
      leaseUntil: Timestamp.fromMillis(now.toMillis() + LEASE_MS),
      updatedAt: now
    })
    leased = true
  })
  return leased
}

export const scheduledNotificationDispatcher = onSchedule(
  { schedule: 'every 1 minutes', timeZone: 'UTC', region: SCHEDULER_REGION },
  async () => {
    const now = Timestamp.now()

    const snapshot = await scheduledCollection
      .where('fireAt', '<=', now)
      .orderBy('fireAt')
      .limit(DISPATCH_LIMIT * 3)
      .get()

    if (snapshot.empty) {
      try {
        const nextSnap = await scheduledCollection
          .orderBy('fireAt')
          .limit(1)
          .get()
        if (nextSnap.empty) {
          console.log('[scheduledNotificationDispatcher] No notifications scheduled at', now.toDate().toISOString())
        } else {
          const nextDoc = nextSnap.docs[0]
          const nextData = nextDoc.data() as any
          const nextFireAt = nextData.fireAt?.toDate?.().toISOString?.() || null
          console.log('[scheduledNotificationDispatcher] No notifications due at', now.toDate().toISOString(), 'next scheduled at', nextFireAt, 'status', nextData.status, 'doc', nextDoc.id)
        }
      } catch (err: any) {
        console.warn('[scheduledNotificationDispatcher] Failed to check next scheduled notification', err?.message || err)
      }
      return
    }

    console.log('[scheduledNotificationDispatcher] Fetched', snapshot.size, 'docs at', now.toDate().toISOString())

    for (const doc of snapshot.docs) {
      const data = doc.data() as any
      if (data.status !== 'pending') {
        console.log('[scheduledNotificationDispatcher] Skip non-pending doc', doc.id, data.status)
        continue
      }

      const leased = await leaseNotification(doc.ref, now)
      if (!leased) {
        console.log('[scheduledNotificationDispatcher] Skip lease for doc', doc.id)
        continue
      }
      const uid = data.uid as string
      const payload = data.payload || {}
      const title = payload.title || 'LiveGrid'
      const body = payload.body || ''
      const dataPayload = payload.data || {}
      const tag = dataPayload.tag || data.dedupeKey

      try {
        const userDoc = await usersCollection.doc(uid).get()
        const tokens: string[] = userDoc.exists && Array.isArray(userDoc.data()?.tokens) ? userDoc.data()!.tokens : []
        if (!userDoc.exists) {
          console.log('[scheduledNotificationDispatcher] Missing user doc for uid', uid, 'doc', doc.id)
        }

        if (!tokens.length) {
          const reason = userDoc.exists ? 'no_tokens' : 'missing_user_doc'
          console.log('[scheduledNotificationDispatcher] Undeliverable notification', {
            uid,
            docId: doc.id,
            reason,
            userDocExists: userDoc.exists,
            tokensCount: tokens.length
          })
          await doc.ref.update({
            status: 'undeliverable',
            undeliverableReason: reason,
            undeliverableAt: now,
            leaseUntil: null,
            updatedAt: now
          })
          continue
        }

        const tokenDocs = tokens.length
          ? await db.getAll(...tokens.map(tokenValue => db.collection('notificationTokens').doc(tokenValue)))
          : []
        const tokenMeta = tokenDocs.map((snap, idx) => {
          const tokenValue = tokens[idx]
          const hash = tokenFingerprint(tokenValue)
          if (!snap.exists) {
            return { tokenHash: hash, missingTokenDoc: true }
          }
          const data = snap.data() as any
          const client = data?.clientInfo || {}
          const lastSeenAt = data?.lastSeenAt?.toDate?.()?.toISOString?.() || null
          return {
            tokenHash: hash,
            platform: data?.platform || null,
            appVersion: data?.appVersion || null,
            timezone: data?.timezone || null,
            os: client?.os || null,
            browser: client?.browser || null,
            deviceClass: client?.deviceClass || null,
            isStandalone: client?.isStandalone ?? null,
            displayMode: client?.displayMode || null,
            lastSeenAt,
            tokenUid: data?.uid || null,
            missingTokenDoc: false
          }
        })
        if (tokenMeta.length) {
          console.log('[scheduledNotificationDispatcher] Token metadata', {
            docId: doc.id,
            uid,
            tokens: tokenMeta
          })
        }
        const tokenMetaByHash = new Map(tokenMeta.map(entry => [entry.tokenHash, entry]))

        const message = buildMessage({
          tokenList: tokens,
          title,
          body,
          data: dataPayload,
          tag
        })

        const response = await messaging.sendEachForMulticast(message)

        const invalidTokens: string[] = []
        let transientFailures = 0
        const failureDetails: Array<{
          tokenHash: string | null
          code?: string
          message?: string
          platform?: string | null
          deviceClass?: string | null
          os?: string | null
          browser?: string | null
          isStandalone?: boolean | null
        }> = []

        response.responses.forEach((resp, idx) => {
          if (resp.success) return
          const code = resp.error?.code
          const tokenHash = tokenFingerprint(tokens[idx])
          const meta = tokenHash ? tokenMetaByHash.get(tokenHash) : null
          failureDetails.push({
            tokenHash,
            code,
            message: resp.error?.message,
            platform: meta?.platform ?? null,
            deviceClass: meta?.deviceClass ?? null,
            os: meta?.os ?? null,
            browser: meta?.browser ?? null,
            isStandalone: meta?.isStandalone ?? null
          })
          if (isInvalidTokenError(code)) {
            invalidTokens.push(tokens[idx])
          } else if (isTransientMessagingError(code)) {
            transientFailures += 1
          }
        })

        console.log('[scheduledNotificationDispatcher] Dispatch result', {
          docId: doc.id,
          uid,
          tokenCount: tokens.length,
          successCount: response.successCount,
          failureCount: response.failureCount,
          invalidTokens: invalidTokens.length,
          transientFailures
        })
        if (failureDetails.length) {
          console.log('[scheduledNotificationDispatcher] Token failures', {
            docId: doc.id,
            uid,
            failures: failureDetails
          })
        }

        if (invalidTokens.length) {
          await usersCollection.doc(uid).set({
            tokens: FieldValue.arrayRemove(...invalidTokens),
            updatedAt: FieldValue.serverTimestamp()
          }, { merge: true })
        }

        if (response.successCount === tokens.length) {
          await doc.ref.update({
            status: 'sent',
            sentAt: now,
            leaseUntil: null,
            updatedAt: now,
            successCount: response.successCount,
            failureCount: response.failureCount,
            transientFailures
          })
          continue
        }

        if (response.successCount > 0) {
          await doc.ref.update({
            status: 'partial',
            sentAt: now,
            leaseUntil: null,
            updatedAt: now,
            successCount: response.successCount,
            failureCount: response.failureCount,
            transientFailures
          })
          continue
        }

        if (transientFailures > 0) {
          await doc.ref.update({
            status: 'pending',
            leaseUntil: null,
            updatedAt: now,
            fireAt: Timestamp.fromMillis(now.toMillis() + 60 * 1000),
            retryCount: FieldValue.increment(1),
            successCount: response.successCount,
            failureCount: response.failureCount,
            transientFailures
          })
          continue
        }

        const undeliverableReason = invalidTokens.length === tokens.length ? 'invalid_tokens' : 'all_failed'
        await doc.ref.update({
          status: 'undeliverable',
          undeliverableReason,
          undeliverableAt: now,
          leaseUntil: null,
          updatedAt: now,
          successCount: response.successCount,
          failureCount: response.failureCount,
          transientFailures
        })
      } catch (err: any) {
        console.error('[scheduler] Failed to dispatch notification', doc.id, err?.message || err)
        await doc.ref.update({
          status: 'pending',
          leaseUntil: null,
          updatedAt: now,
          fireAt: Timestamp.fromMillis(now.toMillis() + 60 * 1000),
          retryCount: FieldValue.increment(1)
        })
      }
    }
  }
)

class SheetsError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function getClientIp(req: { get: (name: string) => string | undefined; ip?: string }) {
  const forwarded = req.get('x-forwarded-for') || ''
  const ip = forwarded.split(',')[0]?.trim()
  return ip || req.ip || 'unknown'
}

function rateLimitSheets(req: { get: (name: string) => string | undefined; ip?: string }, res: any) {
  const ip = getClientIp(req)
  const now = Date.now()
  const existing = sheetRateLimit.get(ip)
  if (existing && now < existing.resetAt) {
    if (existing.count >= SHEETS_RATE_LIMIT_MAX) {
      res.status(429).json({ error: 'Too many requests' })
      return false
    }
    existing.count += 1
    return true
  }
  sheetRateLimit.set(ip, { count: 1, resetAt: now + SHEETS_RATE_LIMIT_WINDOW_MS })
  return true
}

function getCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string) {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function setCachedValue<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

function redactSheetsUrl(rawUrl: string) {
  if (!rawUrl) return rawUrl
  try {
    const url = new URL(rawUrl)
    if (url.searchParams.has('key')) {
      url.searchParams.set('key', 'REDACTED')
    }
    return url.toString()
  } catch (err) {
    return rawUrl.replace(/key=[^&]+/g, 'key=REDACTED')
  }
}

async function readResponseBody(response: any) {
  try {
    return await response.text()
  } catch (err) {
    console.warn('[sheetsApi] Failed to read upstream response body', err)
    return ''
  }
}

function withInFlight<T>(map: Map<string, Promise<T>>, key: string, task: () => Promise<T>) {
  const existing = map.get(key)
  if (existing) return existing
  const promise = task().finally(() => map.delete(key))
  map.set(key, promise)
  return promise
}

function extractSpreadsheetId(input: string) {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (match) return match[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed
  return null
}

function formatSheetRange(sheetTitle: string, range: string) {
  const safeTitle = sheetTitle.replace(/'/g, "''")
  return `'${safeTitle}'!${range}`
}

function normalizeSheetValues(values: any[][]) {
  if (!Array.isArray(values) || values.length === 0) {
    return { headers: [], rows: [] }
  }

  const rawHeaders = Array.isArray(values[0]) ? values[0] : []
  const maxRowLength = values.reduce((max, row) => {
    if (!Array.isArray(row)) return max
    return Math.max(max, row.length)
  }, 0)
  const width = Math.max(rawHeaders.length, maxRowLength)

  const headers = Array.from({ length: width }).map((_, idx) => {
    const value = rawHeaders[idx]
    return value === undefined || value === null ? '' : String(value)
  })

  const rows = values.slice(1).map(row => {
    const normalizedRow = Array.from({ length: width }).map((_, idx) => {
      const value = Array.isArray(row) ? row[idx] : ''
      return value === undefined || value === null ? '' : String(value)
    })
    return normalizedRow
  })

  return { headers, rows }
}

function shouldWidenRange(values: any[][]) {
  if (!Array.isArray(values) || values.length === 0) return false
  const header = Array.isArray(values[0]) ? values[0] : []
  if (header.length < 26) return false
  const lastCell = header[25]
  if (lastCell === undefined || lastCell === null) return false
  return String(lastCell).trim().length > 0
}

async function fetchSheetMetadataFromApi(spreadsheetId: string): Promise<SheetMetadata> {
  if (!SHEETS_API_KEY) {
    throw new SheetsError(500, 'Sheets API key is not configured')
  }

  const params = new URLSearchParams({
    key: SHEETS_API_KEY,
    includeGridData: 'false'
  })
  const url = `${SHEETS_API_BASE}/${spreadsheetId}?${params.toString()}`
  const requestStart = Date.now()
  console.log('[sheetsApi] Metadata fetch', {
    spreadsheetId,
    url: redactSheetsUrl(url)
  })
  const response = await fetch(url)
  const durationMs = Date.now() - requestStart

  if (response.status === 404) {
    const body = await readResponseBody(response)
    console.warn('[sheetsApi] Metadata fetch failed', {
      spreadsheetId,
      status: response.status,
      durationMs,
      bodySnippet: body.slice(0, 400)
    })
    throw new SheetsError(404, 'Spreadsheet not found')
  }
  if (response.status === 403) {
    const body = await readResponseBody(response)
    console.warn('[sheetsApi] Metadata fetch failed', {
      spreadsheetId,
      status: response.status,
      durationMs,
      bodySnippet: body.slice(0, 400)
    })
    throw new SheetsError(403, 'Spreadsheet is not publicly accessible')
  }
  if (!response.ok) {
    const body = await readResponseBody(response)
    console.warn('[sheetsApi] Metadata fetch failed', {
      spreadsheetId,
      status: response.status,
      durationMs,
      bodySnippet: body.slice(0, 400)
    })
    throw new SheetsError(502, `Sheets API error (${response.status})`)
  }

  const data = await response.json()
  console.log('[sheetsApi] Metadata payload raw', JSON.stringify({ spreadsheetId, metadata: data }))
  console.log('[sheetsApi] Metadata fetch ok', {
    spreadsheetId,
    status: response.status,
    durationMs,
    tabCount: Array.isArray(data?.sheets) ? data.sheets.length : 0
  })
  const tabs: SheetTab[] = Array.isArray(data?.sheets)
    ? data.sheets
        .map((sheet: any) => ({
          sheetId: sheet?.properties?.sheetId,
          title: sheet?.properties?.title
        }))
        .filter((sheet: SheetTab) => typeof sheet.sheetId === 'number' && typeof sheet.title === 'string')
    : []

  return {
    spreadsheetId: data?.spreadsheetId || spreadsheetId,
    spreadsheetTitle: data?.properties?.title || null,
    tabs,
    fetchedAt: Date.now()
  }
}

async function fetchSheetValuesRange(spreadsheetId: string, sheetTitle: string, rangeEnd: string) {
  if (!SHEETS_API_KEY) {
    throw new SheetsError(500, 'Sheets API key is not configured')
  }

  const range = formatSheetRange(sheetTitle, `A:${rangeEnd}`)
  const params = new URLSearchParams()
  params.append('key', SHEETS_API_KEY)
  params.append('majorDimension', 'ROWS')
  params.append('valueRenderOption', 'FORMATTED_VALUE')
  params.append('dateTimeRenderOption', 'FORMATTED_STRING')
  params.append('ranges', range)

  const url = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?${params.toString()}`
  const requestStart = Date.now()
  console.log('[sheetsApi] Values fetch', {
    spreadsheetId,
    sheetTitle,
    rangeEnd,
    url: redactSheetsUrl(url)
  })
  const response = await fetch(url)
  const durationMs = Date.now() - requestStart

  if (response.status === 404) {
    const body = await readResponseBody(response)
    console.warn('[sheetsApi] Values fetch failed', {
      spreadsheetId,
      sheetTitle,
      rangeEnd,
      status: response.status,
      durationMs,
      bodySnippet: body.slice(0, 400)
    })
    throw new SheetsError(404, 'Spreadsheet values not found')
  }
  if (response.status === 403) {
    const body = await readResponseBody(response)
    console.warn('[sheetsApi] Values fetch failed', {
      spreadsheetId,
      sheetTitle,
      rangeEnd,
      status: response.status,
      durationMs,
      bodySnippet: body.slice(0, 400)
    })
    throw new SheetsError(403, 'Spreadsheet is not publicly accessible')
  }
  if (!response.ok) {
    const body = await readResponseBody(response)
    console.warn('[sheetsApi] Values fetch failed', {
      spreadsheetId,
      sheetTitle,
      rangeEnd,
      status: response.status,
      durationMs,
      bodySnippet: body.slice(0, 400)
    })
    throw new SheetsError(502, `Sheets API error (${response.status})`)
  }

  const data = await response.json()
  console.log('[sheetsApi] Values fetch ok', {
    spreadsheetId,
    sheetTitle,
    rangeEnd,
    status: response.status,
    durationMs,
    valueRanges: Array.isArray(data?.valueRanges) ? data.valueRanges.length : 0
  })
  const valueRanges = Array.isArray(data?.valueRanges) ? data.valueRanges : []
  const values = Array.isArray(valueRanges[0]?.values) ? valueRanges[0].values : []
  return values as any[][]
}

async function fetchSheetValuesFromApi(spreadsheetId: string, sheetTitle: string) {
  const baseValues = await fetchSheetValuesRange(spreadsheetId, sheetTitle, SHEETS_DEFAULT_RANGE_END)
  if (shouldWidenRange(baseValues)) {
    return await fetchSheetValuesRange(spreadsheetId, sheetTitle, SHEETS_WIDE_RANGE_END)
  }
  return baseValues
}

async function getSheetMetadata(spreadsheetId: string, options: { forceRefresh?: boolean } = {}) {
  const cacheKey = spreadsheetId
  if (!options.forceRefresh) {
    const cached = getCachedValue(sheetMetadataCache, cacheKey)
    if (cached) {
      console.log('[sheetsApi] Metadata cache hit', {
        spreadsheetId,
        ageMs: Date.now() - cached.fetchedAt,
        tabCount: cached.tabs.length
      })
      return cached
    }
  }

  if (!options.forceRefresh) {
    const snap = await sheetMetadataCollection.doc(spreadsheetId).get()
    if (snap.exists) {
      const data = snap.data() as any
      const fetchedAt = data?.lastMetadataFetchAt?.toMillis?.() || 0
      const tabs = Array.isArray(data?.tabs) ? data.tabs : []
      if (fetchedAt && Date.now() - fetchedAt < SHEETS_METADATA_TTL_MS && tabs.length) {
        console.log('[sheetsApi] Metadata firestore hit', {
          spreadsheetId,
          ageMs: Date.now() - fetchedAt,
          tabCount: tabs.length
        })
        const metadata: SheetMetadata = {
          spreadsheetId,
          spreadsheetTitle: data?.spreadsheetTitle || null,
          tabs,
          fetchedAt
        }
        setCachedValue(sheetMetadataCache, cacheKey, metadata, SHEETS_METADATA_TTL_MS)
        return metadata
      }
    }
  }

  return withInFlight(sheetMetadataInFlight, cacheKey, async () => {
    const metadata = await fetchSheetMetadataFromApi(spreadsheetId)
    setCachedValue(sheetMetadataCache, cacheKey, metadata, SHEETS_METADATA_TTL_MS)
    await sheetMetadataCollection.doc(spreadsheetId).set({
      spreadsheetId: metadata.spreadsheetId,
      spreadsheetTitle: metadata.spreadsheetTitle,
      tabs: metadata.tabs,
      lastMetadataFetchAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
    return metadata
  })
}

function sheetDocId(spreadsheetId: string, sheetId: number) {
  return `${spreadsheetId}__${sheetId}`
}

async function getSheetValues(spreadsheetId: string, sheetId: number) {
  const cacheKey = `${spreadsheetId}:${sheetId}`
  const cached = getCachedValue(sheetValuesCache, cacheKey)
  if (cached) {
    console.log('[sheetsApi] Values cache hit', {
      spreadsheetId,
      sheetId,
      ageMs: Date.now() - cached.fetchedAt,
      rows: cached.rows.length
    })
    return cached
  }

  const fallbackSnap = await sheetSourcesCollection.doc(sheetDocId(spreadsheetId, sheetId)).get()
  let fallback: SheetValues | null = null
  if (fallbackSnap.exists) {
    const data = fallbackSnap.data() as any
    const fetchedAt = data?.lastValuesFetchAt?.toMillis?.() || 0
    fallback = {
      spreadsheetId,
      spreadsheetTitle: data?.spreadsheetTitle || null,
      sheetId,
      sheetTitle: data?.sheetTitle || 'Sheet',
      headers: Array.isArray(data?.headers) ? data.headers : [],
      rows: Array.isArray(data?.rows)
        ? data.rows.map((row: any) => (Array.isArray(row?.cells) ? row.cells.map(String) : []))
        : [],
      fetchedAt,
      contentHash: data?.contentHash || ''
    }
    if (fetchedAt && Date.now() - fetchedAt < SHEETS_VALUES_TTL_MS) {
      console.log('[sheetsApi] Values firestore hit', {
        spreadsheetId,
        sheetId,
        ageMs: Date.now() - fetchedAt,
        rows: fallback.rows.length
      })
      setCachedValue(sheetValuesCache, cacheKey, fallback, SHEETS_VALUES_TTL_MS)
      return fallback
    }
  }

  try {
    return await withInFlight(sheetValuesInFlight, cacheKey, async () => {
      let metadata = await getSheetMetadata(spreadsheetId)
      let tab = metadata.tabs.find(entry => entry.sheetId === sheetId)
      if (!tab) {
        metadata = await getSheetMetadata(spreadsheetId, { forceRefresh: true })
        tab = metadata.tabs.find(entry => entry.sheetId === sheetId)
      }
      if (!tab) {
        throw new SheetsError(404, 'Sheet tab not found')
      }

      const spreadsheetTitle = metadata.spreadsheetTitle || null
      const rawValues = await fetchSheetValuesFromApi(spreadsheetId, tab.title)
      const normalized = normalizeSheetValues(rawValues)
      const contentHash = createHash('sha256')
        .update(JSON.stringify({ headers: normalized.headers, rows: normalized.rows }))
        .digest('hex')

      const result: SheetValues = {
        spreadsheetId,
        spreadsheetTitle,
        sheetId,
        sheetTitle: tab.title,
        headers: normalized.headers,
        rows: normalized.rows,
        fetchedAt: Date.now(),
        contentHash
      }

      setCachedValue(sheetValuesCache, cacheKey, result, SHEETS_VALUES_TTL_MS)
      await sheetSourcesCollection.doc(sheetDocId(spreadsheetId, sheetId)).set({
        spreadsheetId,
        spreadsheetTitle,
        sheetId,
        sheetTitle: tab.title,
        headers: normalized.headers,
        rows: normalized.rows.map(cells => ({ cells })),
        contentHash,
        isStale: false,
        lastValuesFetchAt: FieldValue.serverTimestamp(),
        lastSuccessfulParseAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })

      return result
    })
  } catch (err: any) {
    console.warn('[sheetsApi] Values fetch failed', {
      spreadsheetId,
      sheetId,
      error: err?.message || err
    })
    if (fallback) {
      console.warn('[sheetsApi] Using stale values', {
        spreadsheetId,
        sheetId,
        ageMs: Date.now() - fallback.fetchedAt,
        rows: fallback.rows.length
      })
      await sheetSourcesCollection.doc(sheetDocId(spreadsheetId, sheetId)).set({
        isStale: true,
        staleReason: err?.message || 'upstream_error',
        staleAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
      return fallback
    }
    throw err
  }
}

export const sheetsApi = onRequest({ cors: true, region: SCHEDULER_REGION, secrets: ['SHEETS_API_KEY'] }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }

  if (!rateLimitSheets(req, res)) return

  try {
    const requestId = buildRequestId()
    res.set('x-request-id', requestId)
    let path = (req.path || '').replace(/^\/+/, '')
    if (path.startsWith('api/')) {
      path = path.slice(4)
    }
    console.log('[sheetsApi] Request', {
      requestId,
      method: req.method,
      path,
      ip: getClientIp(req),
      userAgent: req.get('user-agent') || 'unknown',
      hasApiKey: Boolean(SHEETS_API_KEY)
    })

    if (req.method === 'POST' && path === 'sheets/resolve') {
      const { url } = req.body || {}
      const spreadsheetId = extractSpreadsheetId(url)
      console.log('[sheetsApi] Resolve request', { requestId, spreadsheetId, hasUrl: Boolean(url) })
      if (!spreadsheetId) {
        res.status(400).json({ error: 'Invalid Google Sheets URL' })
        return
      }
      res.json({ spreadsheetId })
      return
    }

    const tabsMatch = path.match(/^sheets\/([^/]+)\/tabs$/)
    if (req.method === 'GET' && tabsMatch) {
      const spreadsheetId = tabsMatch[1]
      console.log('[sheetsApi] Tabs request', { requestId, spreadsheetId })
      const metadata = await getSheetMetadata(spreadsheetId)
      console.log('[sheetsApi] Tabs response', { requestId, spreadsheetId, tabCount: metadata.tabs.length })
      res.json({
        spreadsheetId: metadata.spreadsheetId,
        spreadsheetTitle: metadata.spreadsheetTitle,
        tabs: metadata.tabs
      })
      return
    }

    const tabMatch = path.match(/^sheets\/([^/]+)\/tab\/([^/]+)$/)
    if (req.method === 'GET' && tabMatch) {
      const spreadsheetId = tabMatch[1]
      const sheetIdRaw = tabMatch[2]
      const sheetId = Number(sheetIdRaw)
      console.log('[sheetsApi] Tab values request', { requestId, spreadsheetId, sheetId })
      if (!Number.isFinite(sheetId)) {
        res.status(400).json({ error: 'sheetId must be a number' })
        return
      }
      const values = await getSheetValues(spreadsheetId, sheetId)
      console.log('[sheetsApi] Tab values response', {
        requestId,
        spreadsheetId,
        sheetId,
        spreadsheetTitle: values.spreadsheetTitle,
        headers: values.headers.length,
        rows: values.rows.length
      })
      res.json({
        spreadsheetId: values.spreadsheetId,
        spreadsheetTitle: values.spreadsheetTitle,
        sheetId: values.sheetId,
        sheetTitle: values.sheetTitle,
        headers: values.headers,
        rows: values.rows
      })
      return
    }

    res.status(404).json({ error: 'Not found' })
  } catch (err: any) {
    if (err instanceof SheetsError) {
      console.warn('[sheetsApi] Sheets error', {
        status: err.status,
        message: err.message
      })
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('[sheetsApi] Unexpected error', err)
    res.status(500).json({ error: 'Internal error' })
  }
})

