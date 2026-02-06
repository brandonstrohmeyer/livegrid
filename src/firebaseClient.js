import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import {
  getFirestore,
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence
} from 'firebase/firestore'

const runtimeAuthDomain =
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
  (typeof window !== 'undefined' ? window.location.host : undefined)

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: runtimeAuthDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
}

const missingConfig = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missingConfig.length) {
  console.warn(
    '[firebase] Missing config values for:',
    missingConfig.join(', '),
    '\nSet the corresponding VITE_FIREBASE_* env vars to enable auth + sync.'
  )
}

const isFirebaseConfigured = missingConfig.length === 0

let firebaseApp = null
let auth = null
let firestore = null
let functions = null
if (isFirebaseConfigured) {
  firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig)
  auth = getAuth(firebaseApp)
  firestore = getFirestore(firebaseApp)
  functions = getFunctions(firebaseApp, 'us-central1')
} else {
  console.info('[firebase] Client SDK disabled: missing config values')
}

const useEmulators =
  isFirebaseConfigured && import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

if (useEmulators && auth && firestore) {
  const authHost = import.meta.env.VITE_FIREBASE_EMULATOR_AUTH || 'http://localhost:9099'
  const firestoreHost = import.meta.env.VITE_FIREBASE_EMULATOR_FIRESTORE || 'localhost:8080'
  try {
    connectAuthEmulator(auth, authHost, { disableWarnings: true })
  } catch (err) {
    console.warn('[firebase] Failed to connect auth emulator', err)
  }
  try {
    const [host, portString] = firestoreHost.split(':')
    const port = Number(portString || 8080)
    connectFirestoreEmulator(firestore, host, port)
  } catch (err) {
    console.warn('[firebase] Failed to connect firestore emulator', err)
  }
}

if (useEmulators && functions) {
  try {
    connectFunctionsEmulator(functions, 'localhost', 5001)
  } catch (err) {
    console.warn('[firebase] Failed to connect functions emulator', err)
  }
}

let persistencePromise

export function ensureFirestorePersistence({ multiTab = true } = {}) {
  if (typeof window === 'undefined' || !firestore) return Promise.resolve()
  if (!persistencePromise) {
    const enable = multiTab ? enableMultiTabIndexedDbPersistence : enableIndexedDbPersistence
    persistencePromise = enable(firestore).catch(err => {
      if (multiTab && err.code === 'failed-precondition') {
        console.warn('[firebase] Multi-tab persistence failed, retrying single tab mode')
        return enableIndexedDbPersistence(firestore)
      }
      if (err.code === 'unimplemented') {
        console.warn('[firebase] IndexedDB persistence unavailable in this browser.')
        return null
      }
      console.error('[firebase] Failed to enable persistence', err)
      return null
    })
  }
  return persistencePromise
}

export { firebaseApp, auth, firestore, functions, isFirebaseConfigured }
