import admin from 'firebase-admin'

const projectId = process.env.GCLOUD_PROJECT || 'livegrid-c33c6'

if (!admin.apps.length) {
  admin.initializeApp({ projectId })
}

const db = admin.firestore()

async function clearCollection(name) {
  const snap = await db.collection(name).get()
  if (snap.empty) return
  const batch = db.batch()
  snap.docs.forEach(doc => batch.delete(doc.ref))
  await batch.commit()
}

async function clearFirestore() {
  await Promise.all([
    clearCollection('notificationTokens'),
    clearCollection('users'),
    clearCollection('scheduledNotifications'),
    clearCollection('eventCache'),
    clearCollection('visitorTelemetry'),
    clearCollection('sheetMetadata'),
    clearCollection('sheetSources')
  ])
}

async function createUser({ email, password }) {
  const response = await fetch('http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Auth emulator signup failed: ${response.status} ${text}`)
  }
  return response.json()
}

async function callFunction(functionName, { method = 'POST', body, idToken } = {}) {
  const url = `http://localhost:5001/${projectId}/us-central1/${functionName}`
  const headers = { 'Content-Type': 'application/json' }
  if (idToken) headers.Authorization = `Bearer ${idToken}`
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  })
  return response
}

async function callHosting(path) {
  const response = await fetch(`http://localhost:5000${path}`)
  return response
}

export {
  admin,
  db,
  projectId,
  clearFirestore,
  createUser,
  callFunction,
  callHosting
}
