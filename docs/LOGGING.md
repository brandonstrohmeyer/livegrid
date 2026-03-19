# Logging Guidelines

This project uses structured logs with explicit severity so Cloud Logging and local debugging stay consistent. Logs should be emitted as structured objects (no free-form text messages).

## Severity Rules

Use these as the default mapping:

- `debug`: No-op or "nothing happened" state, noisy diagnostics, retry loops, cache hits, and normal control flow that is not actionable.
- `info`: Successful operations with user or system impact (e.g., request completed, notification scheduled/sent, cache refresh).
- `warning`: Failed operations that are non-user-facing or recoverable (e.g., upstream hiccup, stale fallback, validation issue that returns 4xx with guidance).
- `error`: User-facing failures or loss of functionality (e.g., notification fails to deliver, auth errors that prevent a requested action).

If the failure blocks the user or loses data, it is an `error`. If it is informative but does not block the user, it is a `warning`.

## Examples

- `[scheduledNotificationDispatcher] No notifications due at ...` -> `debug`
- `[scheduledNotificationDispatcher] Fetched ... docs` -> `info`
- `[sheetsApi] Using stale values` -> `warning`
- `[notifications] Push sync failed` -> `error`

## Structure And Fields

Log entries should include a short event name and structured context:

- `event`: Short string (e.g., `scheduled_notifications.no_due`)
- `requestId`, `uid`, `eventId`, `sheetId`, `status`, `durationMs`, `count`
- Avoid logging tokens, secrets, or full URLs with API keys. Redact or hash when needed.

## Implementation

- Backend: `functions/src/logging.ts` wraps `firebase-functions/logger` to enforce structured payloads and severity methods (`debug`, `info`, `warn`, `error`).
- Frontend: `src/logging.js` maps to `console.*`, with `VITE_LOG_LEVEL` support and defaults to `info` in production and `debug` in development.

## Test Correlation

When running integration or post-deploy smoke tests, correlate logs with Firestore data:

1. Capture identifiers from responses (`requestId`, `eventId`, `tokenHash`).
2. Verify Firestore writes (`scheduledNotifications`, `notificationTokens`, `eventCache`).
3. Query Cloud Logging for matching `jsonPayload.event` values.

Example query:

```bash
gcloud logging read \
  'resource.type="cloud_function" AND jsonPayload.event="push.send_response"' \
  --limit 50 --format json
```

Recommended events to confirm per flow:
- `push_token.register_request`, `push_token.stored`
- `push.send_response`
- `notifications.sync_request`, `notifications.sync_complete`
- `scheduler.dispatch_result`, `scheduler.token_failures`
- `sheets.request`, `sheets.tabs_response`, `sheets.tab_values_response`
