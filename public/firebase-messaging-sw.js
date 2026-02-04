self.addEventListener('push', event => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch (err) {
    payload = { title: 'LiveGrid update', body: event.data.text() }
  }

  const notificationPayload = payload.notification || {}
  const data = payload.data || {}
  const title = notificationPayload.title || payload.title || 'LiveGrid update'

  const options = {
    body: notificationPayload.body || payload.body || 'Tap to open LiveGrid.',
    icon: notificationPayload.icon || payload.icon || '/livegrid-icon.png',
    badge: notificationPayload.badge || payload.badge || '/livegrid-icon-maskable.png',
    data,
    tag: notificationPayload.tag || payload.tag,
    renotify: true
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const urlToOpen = event.notification?.data?.url || 'https://livegrid.app/'

  event.waitUntil(
    (async () => {
      const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      let targetOrigin
      try {
        targetOrigin = new URL(urlToOpen, self.location.origin).origin
      } catch (err) {
        targetOrigin = self.location.origin
      }
      const matchingClient = clientsArr.find(client => client.url.startsWith(targetOrigin))
      if (matchingClient) {
        matchingClient.focus()
        return undefined
      }
      return self.clients.openWindow(urlToOpen)
    })()
  )
})
