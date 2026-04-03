import { describe, expect, it } from 'vitest'
import { getFirebaseClientHealth } from '../scripts/firebaseEnvRequirements.mjs'

describe('firebase client health requirements', () => {
  it('reports ok when all required Firebase env vars are present', () => {
    const env = {
      VITE_FIREBASE_API_KEY: 'key',
      VITE_FIREBASE_AUTH_DOMAIN: 'livegrid.example.com',
      VITE_FIREBASE_PROJECT_ID: 'project',
      VITE_FIREBASE_STORAGE_BUCKET: 'bucket',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender',
      VITE_FIREBASE_APP_ID: 'app',
      VITE_FIREBASE_MEASUREMENT_ID: 'measurement'
    }

    expect(getFirebaseClientHealth(env)).toEqual({
      ok: true,
      missingKeys: []
    })
  })

  it('reports missing keys when Firebase env vars are incomplete', () => {
    const result = getFirebaseClientHealth({
      VITE_FIREBASE_API_KEY: 'key',
      VITE_FIREBASE_PROJECT_ID: 'project'
    })

    expect(result.ok).toBe(false)
    expect(result.missingKeys).toContain('VITE_FIREBASE_AUTH_DOMAIN')
    expect(result.missingKeys).toContain('VITE_FIREBASE_APP_ID')
  })
})
