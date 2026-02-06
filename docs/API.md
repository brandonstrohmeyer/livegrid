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

### isOnTrackSession(session)

Returns true when a session has a track name and non-zero duration.

### getSessionPriority(sessionName)

Returns numeric priority (lower is higher priority):
1. Lunch
2. HPDE with number
3. Generic HPDE
4. TT or Race
5. Other

### deduplicateSessions(sessions)

Removes duplicate sessions at the same time, keeping the highest priority.

### shouldExcludeFromRunGroups(sessionName)

Filters out lunches, meetings, awards, and warmups when building run groups.

### extractRunGroups(sessions)

Extracts and normalizes run groups. Returns a list with "All" first.

### fixSessionNameTypos(sessionName)

Fixes common session name typos (e.g., HDPE -> HPDE).

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
