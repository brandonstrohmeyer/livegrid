import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing'
import fs from 'fs'

let testEnv

describe('firestore security rules', () => {
  beforeAll(async () => {
    const rules = fs.readFileSync('firestore.rules', 'utf8')
    testEnv = await initializeTestEnvironment({
      projectId: 'livegrid-c33c6',
      firestore: { rules }
    })
  })

  afterAll(async () => {
    await testEnv.cleanup()
  })

  beforeEach(async () => {
    await testEnv.clearFirestore()
  })

  it('allows users to read/write their own user document', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore()
    await assertSucceeds(db.doc('users/user-1').set({ prefs: { theme: 'dark' } }))
    await assertSucceeds(db.doc('users/user-1').get())

    const otherDb = testEnv.authenticatedContext('user-2').firestore()
    await assertFails(otherDb.doc('users/user-1').get())
  })

  it('restricts notificationTokens to matching uid', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore()
    await assertSucceeds(
      db.doc('notificationTokens/token-1').set({ uid: 'user-1', platform: 'desktop' })
    )

    const otherDb = testEnv.authenticatedContext('user-2').firestore()
    await assertFails(
      otherDb.doc('notificationTokens/token-2').set({ uid: 'user-1', platform: 'desktop' })
    )
    await assertFails(otherDb.doc('notificationTokens/token-1').get())
  })

  it('allows scheduledNotifications create only when pending and unleased', async () => {
    const db = testEnv.authenticatedContext('user-1').firestore()
    const valid = db.doc('scheduledNotifications/notif-1')
    await assertSucceeds(valid.set({
      uid: 'user-1',
      status: 'pending',
      leaseUntil: null,
      sentAt: null
    }))

    const invalid = db.doc('scheduledNotifications/notif-2')
    await assertFails(invalid.set({
      uid: 'user-1',
      status: 'sent',
      leaseUntil: null,
      sentAt: null
    }))
  })
})
