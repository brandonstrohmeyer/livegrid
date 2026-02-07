# API Reference

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
