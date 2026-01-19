const functions = require('firebase-functions/v1')

// Simple proxy for the NASA-SE RSS feed so the frontend can
// avoid CORS issues when fetching from nasa-se.com.
exports.nasaFeed = functions.https.onRequest(async (req, res) => {
  // Basic CORS headers so the hosted app can call this endpoint.
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }

  try {
    const upstream = await fetch('https://nasa-se.com/feed/')
    if (!upstream.ok) {
      console.error('Upstream feed error', upstream.status, upstream.statusText)
      res.status(502).send('Failed to fetch upstream feed')
      return
    }

    const body = await upstream.text()
    const contentType = upstream.headers.get('content-type') || 'application/rss+xml; charset=utf-8'
    res.set('Content-Type', contentType)
    res.status(200).send(body)
  } catch (err) {
    console.error('Error proxying nasa-se feed', err)
    res.status(500).send('Error fetching feed')
  }
})
