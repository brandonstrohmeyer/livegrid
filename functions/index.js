const functions = require('firebase-functions/v2')
const admin = require('firebase-admin')

admin.initializeApp()

const db = admin.firestore()
const messaging = admin.messaging()

const defaultHost = process.env.GCLOUD_PROJECT ? `https://${process.env.GCLOUD_PROJECT}.web.app` : 'https://livegrid.app'
const appPublicUrl = process.env.APP_PUBLIC_URL || defaultHost

async function authenticate(req) {
  const authHeader = req.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.substring(7)
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    return decoded.uid
  } catch (err) {
    console.warn('[functions] Failed to verify auth token', err.message)
    return null
  }
}

function sanitizeData(payload = {}) {
  return Object.entries(payload).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) return acc
    acc[key] = typeof value === 'string' ? value : JSON.stringify(value)
    return acc
  }, {})
}

// Simple proxy for the NASA-SE RSS feed so the frontend can avoid CORS issues.
exports.nasaFeed = functions.https.onRequest({ cors: true }, async (req, res) => {
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

exports.registerPushToken = functions.https.onRequest({ cors: true }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed')
    return
  }

  const { token, platform = 'web', timezone = null, appVersion = null } = req.body || {}
  if (!token) {
    res.status(400).json({ error: 'token is required' })
    return
  }

  const uid = await authenticate(req)

  try {
    await db.collection('notificationTokens').doc(token).set({
      uid: uid || null,
      platform,
      timezone,
      appVersion,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
    res.json({ status: 'registered' })
  } catch (err) {
    console.error('Failed to store push token', err)
    res.status(500).json({ error: 'Failed to store token' })
  }
})

exports.unregisterPushToken = functions.https.onRequest({ cors: true }, async (req, res) => {
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

  try {
    await db.collection('notificationTokens').doc(token).delete()
    res.json({ status: 'deleted' })
  } catch (err) {
    console.error('Failed to delete push token', err)
    res.status(500).json({ error: 'Failed to delete token' })
  }
})

exports.sendPushNotification = functions.https.onRequest({ cors: true }, async (req, res) => {
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

  const sanitized = sanitizeData(data)
  if (tag) sanitized.tag = tag

  const message = {
    token,
    notification: { title, body },
    data: sanitized,
    android: {
      priority: 'high'
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

  try {
    const response = await messaging.send(message)
    console.log('[sendPushNotification] FCM response:', response)
    res.json({ status: 'sent', id: response, requestedBy: uid || null })
  } catch (err) {
    console.error('Failed to send push message', err)
    if (err && err.stack) {
      console.error('Stack:', err.stack)
    }
    res.status(500).json({ error: 'Failed to send push message', details: err && err.message ? err.message : err })
  }
})
