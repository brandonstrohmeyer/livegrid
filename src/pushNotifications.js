import { deleteToken, getMessaging, getToken, isSupported } from 'firebase/messaging'
import { firebaseApp, isFirebaseConfigured } from './firebaseClient'

const messagingSwPath = '/firebase-messaging-sw.js'
const messagingSwScope = '/firebase-cloud-messaging-push-scope'
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
const rawFunctionsBaseUrl = (import.meta.env.VITE_FUNCTIONS_BASE_URL || '').trim()
const functionsBaseUrl = rawFunctionsBaseUrl ? rawFunctionsBaseUrl.replace(/\/+$/, '') : ''

const endpoint = (proxyPath, functionName) => {
  if (!functionsBaseUrl) {
    return `/api/${proxyPath}`
  }

  // If the base already points directly at a specific function (e.g. emulator URL), use it as-is.
  if (functionsBaseUrl.endsWith(`/${functionName}`)) {
    return functionsBaseUrl
  }

  return `${functionsBaseUrl}/${functionName}`
}

const REGISTER_ENDPOINT = endpoint('register-push-token', 'registerPushToken')
const UNREGISTER_ENDPOINT = endpoint('unregister-push-token', 'unregisterPushToken')
const SEND_PUSH_ENDPOINT = endpoint('send-push-notification', 'sendPushNotification')

let messagingInstancePromise = null

function getPlatformInfo() {
  if (typeof window === 'undefined') {
    return { platform: 'unknown', clientInfo: {} }
  }
  const ua = navigator?.userAgent || ''
  const isIOS = /iP(ad|hone|od)/.test(ua) || (navigator?.platform === 'MacIntel' && navigator?.maxTouchPoints > 1)
  const isAndroid = /Android/i.test(ua)
  const isMobile = isIOS || isAndroid || /Mobile/i.test(ua)
  const isStandalone = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || !!navigator?.standalone
  let displayMode = 'browser'
  if (window.matchMedia) {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      displayMode = 'standalone'
    } else if (window.matchMedia('(display-mode: fullscreen)').matches) {
      displayMode = 'fullscreen'
    }
  }
  let browser = 'unknown'
  if (/Edg/i.test(ua)) browser = 'edge'
  else if (/Chrome|CriOS/i.test(ua)) browser = 'chrome'
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'firefox'
  else if (/Safari/i.test(ua)) browser = 'safari'

  let os = 'unknown'
  if (isIOS) os = 'ios'
  else if (isAndroid) os = 'android'
  else if (/Windows/i.test(ua)) os = 'windows'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macos'
  else if (/Linux/i.test(ua)) os = 'linux'

  let platform = 'desktop'
  if (isIOS) platform = isStandalone ? 'ios-pwa' : 'ios-browser'
  else if (isAndroid) platform = isStandalone ? 'android-pwa' : 'android-browser'
  else if (isMobile) platform = 'mobile-browser'

  return {
    platform,
    clientInfo: {
      os,
      browser,
      deviceClass: isMobile ? 'mobile' : 'desktop',
      isStandalone,
      displayMode,
      userAgent: ua
    }
  }
}

async function getMessagingInstance() {
  if (!isFirebaseConfigured) return null
  if (typeof window === 'undefined') return null
  if (!messagingInstancePromise) {
    messagingInstancePromise = isSupported().then(supported => {
      if (!supported) {
        console.warn('[messaging] Browser does not support push messaging')
        return null
      }
      return getMessaging(firebaseApp)
    }).catch(err => {
      console.error('[messaging] Unable to initialize messaging SDK', err)
      return null
    })
  }
  return messagingInstancePromise
}

async function ensureMessagingServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    const registration = await navigator.serviceWorker.register(messagingSwPath, { scope: messagingSwScope })
    return registration
  } catch (err) {
    console.error('[messaging] Failed to register Firebase messaging service worker', err)
    return null
  }
}

export async function obtainPushToken() {
  if (!vapidKey) {
    console.warn('[messaging] Missing VITE_FIREBASE_VAPID_KEY, skipping push subscription')
    return null
  }
  const messaging = await getMessagingInstance()
  if (!messaging) return null
  const registration = await ensureMessagingServiceWorker()
  if (!registration) return null
  try {
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration
    })
    return token
  } catch (err) {
    if (err.code === 'messaging/permission-blocked') {
      console.warn('[messaging] Notification permission is blocked')
      return null
    }
    console.error('[messaging] Unable to obtain push token', err)
    throw err
  }
}

export async function revokePushToken(token) {
  const messaging = await getMessagingInstance()
  if (!messaging || !token) return false
  try {
    return await deleteToken(messaging, token)
  } catch (err) {
    console.error('[messaging] Failed to delete push token', err)
    return false
  }
}

async function callFunctions(path, { method = 'POST', body, authToken } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (authToken) headers.Authorization = `Bearer ${authToken}`
  const response = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Functions request failed (${response.status}): ${errorText}`)
  }
  return response.json().catch(() => ({}))
}

export async function registerTokenWithServer({ token, timezone, appVersion, authToken }) {
  if (!token) return null
  const platformInfo = getPlatformInfo()
  console.log('[messaging] Registering push token', {
    platform: platformInfo.platform,
    clientInfo: platformInfo.clientInfo,
    timezone,
    appVersion
  })
  return callFunctions(REGISTER_ENDPOINT, {
    body: {
      token,
      timezone,
      appVersion,
      platform: platformInfo.platform,
      clientInfo: platformInfo.clientInfo
    },
    authToken
  })
}

export async function unregisterTokenWithServer({ token, authToken }) {
  if (!token) return null
  return callFunctions(UNREGISTER_ENDPOINT, {
    body: { token },
    authToken
  })
}

export async function sendServerPush({ token, title, body, data, tag, authToken }) {
  if (!token || !title || !body) return null
  return callFunctions(SEND_PUSH_ENDPOINT, {
    body: { token, title, body, data, tag },
    authToken
  })
}
