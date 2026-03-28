export const REQUIRED_FIREBASE_CLIENT_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MEASUREMENT_ID'
]

export function getFirebaseClientHealth(envSource = {}) {
  const missingKeys = REQUIRED_FIREBASE_CLIENT_ENV_KEYS.filter(key => {
    const value = envSource[key]
    return typeof value !== 'string' || !value.trim()
  })

  return {
    ok: missingKeys.length === 0,
    missingKeys
  }
}

