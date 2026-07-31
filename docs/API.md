# API Reference

## URL Query Parameters

### sheetUrl

Prefills the selected schedule from a Google Sheets URL. This is intended for
event-specific links and QR codes.

Example:

```text
https://livegrid.stro.io/?sheetUrl=https%3A%2F%2Fdocs.google.com%2Fspreadsheets%2Fd%2FYOUR_SHEET_ID%2Fedit%23gid%3D123
```

Aliases: `sheet`, `scheduleUrl`, `schedule`.

When building the URL, encode the Google Sheets URL so any `#gid=...` fragment
and query string values stay inside the parameter value.

### event

Prefills the selected schedule from a cached event id. This keeps the selected
event identity and date range intact, even when multiple events use the same
Google spreadsheet.

Example:

```text
https://livegrid.stro.io/?event=manual%3Amanual-event-id
```

Aliases: `eventId`, `event_id`.

If both `sheetUrl` and `event` are present, `sheetUrl` takes precedence.

## Cloud Functions

### GET /api/admin-events

Checks whether the signed-in Firebase user can access the admin console.
Requires `Authorization: Bearer <Firebase ID token>`.

Admins are users with a Firebase custom claim of `livegridAdmin: true` or
`admin: true`, or users listed in the Functions env vars
`LIVEGRID_ADMIN_UIDS` / `LIVEGRID_ADMIN_EMAILS`.

### POST /api/admin-events

Creates or updates a persistent event in `eventCache` using the same public
shape returned by auto-discovered events.

Body:

```json
{
  "title": "Event title",
  "sheetUrl": "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit#gid=123",
  "startDate": "2026-05-01",
  "endDate": "2026-05-02"
}
```

The stored event uses `source: "manual"`, `dateSource: "admin"`,
`dateResolved: true`, and the standard `startDateKey` / `endDateKey` format.

### DELETE /api/admin-events

Removes a persistent manual event from the shared cache.
Requires `Authorization: Bearer <Firebase ID token>`.

Body:

```json
{
  "id": "manual:manual-event-id"
}
```

Only events with `source: "manual"` and `isPersistent: true` can be deleted.

## Utility Functions (scheduleUtils.js)

### parseTimeToToday(timeStr, dayOffset = 0)

Parses a time string to a Date object set to today with that time.

- `timeStr`: "H:MM AM/PM", "HH:MM AM/PM", or "HH:MM"
- `dayOffset`: days to add/subtract from today

Returns: `Date | null`

### addMinutes(date, minutes)

Returns a new Date with minutes added.

### isTimeRow(row)

Returns true if a CSV row contains a time entry.

## Schedule Parser Registry (src/schedule/parsers/registry.js)

### getParserById(parserId)

Returns the registered parser for an organization.

### parseCsvSchedule({ csvText, parserId, dayOffset, sourceLabel })

Parses CSV text using the selected parser and returns a `NormalizedSchedule`.
`sourceLabel` is optional metadata (like a filename) that parsers can use for
day inference when the CSV text does not contain explicit day names.

Parsers may also expose `groupTaxonomy` metadata for mapping tests.

### ScheduleParser (src/schedule/types.js)

- `id`: unique parser ID
- `name`: display name
- `parseCsv({ csvText, dayOffset, sourceLabel })`: returns `NormalizedSchedule`
- `groupTaxonomy` (optional): mapping hints for related-group tests

## Normalized Schedule Model (src/schedule/types.js)

### NormalizedSchedule

- `runGroups`: array of labels (IDs = labels)
- `sessions`: on-track session objects
- `activities`: meeting/classroom objects
- `days`: ordered list of days
- `warnings`: parse warnings (if any)

### NormalizedSession

- `session`, `day`, `start`, `duration`, `end`, `runGroupIds`, `note`, `classroom`

### NormalizedActivity

- `type`, `title`, `day`, `start`, `duration`, `relatedRunGroupIds`, `note`

## Formatting Utilities (App.jsx)

### formatTimeWithAmPm(date)

Returns a formatted string like "8:30 AM".

### formatTimeUntil(milliseconds, session, nowWithOffset)

Returns a string like "now", "45m", or "2h 10m".

## Context Hooks

### useAuth()

Returns:
- `user`: Firebase user or null
- `loading`: boolean
- `error`: error object (if any)
- `signOut()`: sign out the current user

### usePreferences()

Returns:
- `prefs`: current preference map
- `loading`: sync state
- `syncSource`: "local" or "cloud"
- `updatePreference(key, valueOrUpdater, defaultValue)`

### useSyncedPreference(key, defaultValue)

Convenience hook for reading and updating a single preference.

## FirebaseAuthUI Component

Handles sign-in with Google, Apple, and email/password. Provides account creation and password reset flows.

## Push Notifications (pushNotifications.js)

### obtainPushToken()

Requests a push token using Firebase Messaging. Requires `VITE_FIREBASE_VAPID_KEY`.

### revokePushToken(token)

Deletes the local FCM token.

### registerTokenWithServer({ token, timezone, appVersion, authToken })

Registers the token with Functions (`/api/register-push-token`).

### unregisterTokenWithServer({ token, authToken })

Removes the token on the server (`/api/unregister-push-token`).

### sendServerPush({ token, title, body, data, tag, authToken })

Sends a push via Functions (`/api/send-push-notification`).
