import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'
import {
  getFirestore,
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence
} from 'firebase/firestore'
import { log } from './logging.js'

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
  log.warn('firebase.config_missing', {
    missingKeys: missingConfig,
    hint: 'Set the corresponding VITE_FIREBASE_* env vars to enable auth + sync.'
  })
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
  log.info('firebase.client_disabled', { reason: 'missing_config' })
}

const useEmulators =
  isFirebaseConfigured && import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

if (useEmulators && auth && firestore) {
  const authHost = import.meta.env.VITE_FIREBASE_EMULATOR_AUTH || 'http://localhost:9099'
  const firestoreHost = import.meta.env.VITE_FIREBASE_EMULATOR_FIRESTORE || 'localhost:8080'
  try {
    connectAuthEmulator(auth, authHost, { disableWarnings: true })
  } catch (err) {
    log.warn('firebase.emulator_auth_connect_failed', { host: authHost }, err)
  }
  try {
    const [host, portString] = firestoreHost.split(':')
    const port = Number(portString || 8080)
    connectFirestoreEmulator(firestore, host, port)
  } catch (err) {
    log.warn('firebase.emulator_firestore_connect_failed', { host: firestoreHost }, err)
  }
}

if (useEmulators && functions) {
  try {
    connectFunctionsEmulator(functions, 'localhost', 5001)
  } catch (err) {
    log.warn('firebase.emulator_functions_connect_failed', { host: 'localhost:5001' }, err)
  }
}

let persistencePromise

export function ensureFirestorePersistence({ multiTab = true } = {}) {
  if (typeof window === 'undefined' || !firestore) return Promise.resolve()
  if (!persistencePromise) {
    const enable = multiTab ? enableMultiTabIndexedDbPersistence : enableIndexedDbPersistence
    persistencePromise = enable(firestore).catch(err => {
      if (multiTab && err.code === 'failed-precondition') {
        log.warn('firebase.persistence_multi_tab_failed', { fallback: 'single_tab' }, err)
        return enableIndexedDbPersistence(firestore)
      }
      if (err.code === 'unimplemented') {
        log.warn('firebase.persistence_unavailable', { reason: 'unimplemented' }, err)
        return null
      }
      log.error('firebase.persistence_enable_failed', undefined, err)
      return null
    })
  }
  return persistencePromise
}

export { firebaseApp, auth, firestore, functions, isFirebaseConfigured }
