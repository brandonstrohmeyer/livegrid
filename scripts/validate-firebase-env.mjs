import { REQUIRED_FIREBASE_CLIENT_ENV_KEYS, getFirebaseClientHealth } from './firebaseEnvRequirements.mjs'

const { ok, missingKeys } = getFirebaseClientHealth(process.env)

if (!ok) {
  console.error('Missing required Firebase client env vars for production build:')
  missingKeys.forEach(key => console.error(`- ${key}`))
  process.exit(1)
}

console.log(`Validated Firebase client env vars: ${REQUIRED_FIREBASE_CLIENT_ENV_KEYS.length} keys present.`)

