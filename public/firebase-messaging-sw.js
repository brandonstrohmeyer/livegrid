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

  const defaultUrl = 'https://livegrid.stro.io/'
  const options = {
    body: notificationPayload.body || payload.body || 'Tap to open LiveGrid.',
    icon: notificationPayload.icon || payload.icon || '/livegrid-icon.png',
    badge: notificationPayload.badge || payload.badge || '/livegrid-icon-maskable.png',
    data: {
      ...data,
      url: data?.url || payload?.url || defaultUrl
    },
    tag: notificationPayload.tag || payload.tag,
    renotify: true
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const urlToOpen = event.notification?.data?.url || 'https://livegrid.stro.io/'

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
        if ('navigate' in matchingClient) {
          try {
            await matchingClient.navigate(urlToOpen)
          } catch (err) {
            // ignore navigation errors
          }
        }
        matchingClient.focus()
        return undefined
      }
      return self.clients.openWindow(urlToOpen)
    })()
  )
})
