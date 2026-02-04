# API Reference

## Utility Functions (scheduleUtils.js)

### Time Utilities

#### `parseTimeToToday(timeStr, dayOffset = 0)`

Parses a time string to a Date object set to today with that time.

**Parameters:**
- `timeStr` (string) - Time in format "H:MM AM/PM", "HH:MM AM/PM", or "HH:MM"
- `dayOffset` (number) - Days to add/subtract from today (default: 0)

**Returns:** `Date | null`

**Smart Defaults (when AM/PM missing):**
- `12:xx` → Noon (PM)
- `8:00-11:59` → AM
- `1:00-7:59` → PM

**Examples:**
```javascript
parseTimeToToday('8:30 AM')   // Today at 8:30 AM
parseTimeToToday('12:15')     // Today at 12:15 PM (noon)
parseTimeToToday('11:30')     // Today at 11:30 AM
parseTimeToToday('1:30')      // Today at 1:30 PM
parseTimeToToday('8:00 AM', -1) // Yesterday at 8:00 AM
```

#### `addMinutes(date, minutes)`

Adds minutes to a Date object.

**Parameters:**
- `date` (Date) - Source date
- `minutes` (number) - Minutes to add

**Returns:** `Date`

**Example:**
```javascript
const start = new Date('2026-01-18T10:00:00')
const end = addMinutes(start, 30) // 10:30 AM
```

#### `isTimeRow(row)`

Checks if a CSV row contains a time entry.

**Parameters:**
- `row` (Array) - CSV row as array

**Returns:** `boolean`

**Example:**
```javascript
isTimeRow(['8:00 AM', '30', 'HPDE 1']) // true
isTimeRow(['Friday', '', ''])           // false
```

### Filtering Utilities

#### `isOnTrackSession(session)`

Determines if a session should be displayed as an on-track session.

**Parameters:**
- `session` (Object) - Session object with `session` and `duration` properties

**Returns:** `boolean`

**Logic:**
- Includes sessions with non-empty `session` field
- Excludes zero-duration sessions
- Includes lunch

**Example:**
```javascript
isOnTrackSession({ session: 'HPDE 1', duration: 30 })    // true
isOnTrackSession({ session: '', duration: 0 })           // false
isOnTrackSession({ session: 'Lunch', duration: 60 })     // true
```

#### `getSessionPriority(sessionName)`

Returns priority value for session deduplication.

**Parameters:**
- `sessionName` (string) - Session name

**Returns:** `number` (1-5, lower = higher priority)

**Priority Levels:**
1. Lunch
2. HPDE with number (HPDE 1, HPDE 2, etc.)
3. Generic HPDE
4. TT or Race sessions
5. Other

**Example:**
```javascript
getSessionPriority('Lunch')      // 1
getSessionPriority('HPDE 2')     // 2
getSessionPriority('HPDE')       // 3
getSessionPriority('TT Alpha')   // 4
getSessionPriority('Registration') // 5
```

#### `deduplicateSessions(sessions)`

Removes duplicate sessions at the same time, keeping highest priority.

**Parameters:**
- `sessions` (Array) - Array of session objects

**Returns:** `Array` - Deduplicated sessions sorted by start time

**Example:**
```javascript
const sessions = [
  { start: new Date('2026-01-18T09:00'), session: 'HPDE' },
  { start: new Date('2026-01-18T09:00'), session: 'HPDE 1' }
]
deduplicateSessions(sessions) // Returns only HPDE 1 (higher priority)
```

### Run Group Utilities

#### `shouldExcludeFromRunGroups(sessionName)`

Checks if a session should be excluded from run group extraction.

**Parameters:**
- `sessionName` (string) - Session name

**Returns:** `boolean`

**Excluded Patterns:**
- Lunch
- Meetings
- Instructors
- Awards
- TT ALL
- TT Drivers
- ALL RACERS WARMUP

**Example:**
```javascript
shouldExcludeFromRunGroups('Lunch')                  // true
shouldExcludeFromRunGroups('ALL HPDE Drivers Meeting') // true
shouldExcludeFromRunGroups('HPDE 1')                 // false
```

#### `extractRunGroups(sessions)`

Extracts and normalizes run groups from sessions.

**Parameters:**
- `sessions` (Array) - Array of session objects

**Returns:** `Array<string>` - Sorted array with "All" first, then alphabetical

**Normalization Rules:**
- `Thunder Race #1` → `Thunder Race`
- `Lightning Race #2` → `Lightning Race`
- `TTU/a` → `TT Alpha`
- `TTU/b` → `TT Omega`
- `HPDE 3* & 4` → `HPDE 3` and `HPDE 4`

**Example:**
```javascript
extractRunGroups([
  { session: 'HPDE 1' },
  { session: 'Thunder Race #1' },
  { session: 'Lunch' }
])
// Returns: ['All', 'HPDE 1', 'Thunder Race']
```

#### `fixSessionNameTypos(sessionName)`

Corrects common typos in session names.

**Parameters:**
- `sessionName` (string) - Session name

**Returns:** `string` - Corrected session name

**Corrections:**
- `HDPE` → `HPDE`

**Example:**
```javascript
fixSessionNameTypos('HDPE 1') // 'HPDE 1'
```

## Component Functions (App.jsx)

### Meeting Detection

#### `findRelevantMeetings(allRows, selectedDay, selectedGroups, dayOffset)`

Finds meetings relevant to selected run groups.

**Parameters:**
- `allRows` (Array) - All parsed sessions
- `selectedDay` (string) - Selected day name
- `selectedGroups` (Array<string>) - Selected run groups
- `dayOffset` (number) - Day offset for testing

**Returns:** `Array<Object>` - Array of meeting objects

**Meeting Object:**
```javascript
{
  session: string,      // "TT Drivers Meeting"
  customTime: string,   // "12:15" (optional)
  start: Date          // Parsed start time
}
```

**Detected Meetings:**
- **HPDE Meeting**: When any HPDE group selected
- **TT Drivers Meeting**: When any TT group selected
- **All Racers Meeting**: When any race group selected

### Session Queries

#### `findCurrentSession(sessions, nowWithOffset)`

Finds the currently active session.

**Parameters:**
- `sessions` (Array) - Array of session objects
- `nowWithOffset` (Date) - Current time with offsets applied

**Returns:** `Object | null` - Current session or null

**Logic:**
```javascript
nowWithOffset >= session.start && nowWithOffset < session.end
```

#### `sessionMatchesGroup(sessionName, group)`

Checks if a session matches a selected group.

**Parameters:**
- `sessionName` (string) - Session name
- `group` (string) - Group name

**Returns:** `boolean`

**Special Matching:**
- `TT ALL` matches both `TT Alpha` and `TT Omega`
- `TT Drivers` matches both `TT Alpha` and `TT Omega`
- `HPDE 3* & 4` matches both `HPDE 3` and `HPDE 4`
- `Test/Tune & Comp School` matches both components

#### `findNextSession(sessions, selectedGroups, nowWithOffset)`

Finds the next upcoming session for selected groups.

**Parameters:**
- `sessions` (Array) - Array of session objects
- `selectedGroups` (Array<string>) - Selected run groups
- `nowWithOffset` (Date) - Current time with offsets

**Returns:** `Object | null` - Next session or null

**Logic:**
- If "All" selected: returns next session regardless of group
- Otherwise: filters by group match, returns first future session

#### `findNextSessionsPerGroup(sessions, selectedGroups, nowWithOffset)`

Finds next session for each selected group.

**Parameters:**
- `sessions` (Array) - Array of session objects
- `selectedGroups` (Array<string>) - Selected run groups
- `nowWithOffset` (Date) - Current time with offsets

**Returns:** `Object` - Map of group → next session

**Example:**
```javascript
{
  "HPDE 1": { session: "HPDE 1", start: Date, ... },
  "TT Alpha": { session: "TT Alpha", start: Date, ... }
}
```

### Formatting Utilities

#### `formatTimeWithAmPm(date)`

Formats time with small superscript AM/PM.

**Parameters:**
- `date` (Date) - Date to format

**Returns:** `JSX.Element`

**Output:** `8:30` with small `AM`

#### `formatTimeUntil(milliseconds, session, nowWithOffset)`

Formats countdown timer or "now" indicator.

**Parameters:**
- `milliseconds` (number) - Time until session
- `session` (Object) - Session object (optional)
- `nowWithOffset` (Date) - Current time with offsets

**Returns:** `string`

**Formats:**
- `"now"` - If currently in session
- `"2h 15m"` - Hours and minutes
- `"45m"` - Minutes only
- `"0m"` - Less than 1 minute

## Session Object Structure

```javascript
{
  raw: Array,           // Original CSV row
  start: Date,          // Session start time
  duration: number,     // Duration in minutes
  end: Date,            // Session end time
  session: string,      // Session name
  note: string,         // Additional notes (meetings, etc.)
  classroomCell: string, // Classroom session info
  day: string          // "Friday", "Saturday", or "Sunday"
}
```

## Notification Helpers (pushNotifications.js)

The `pushNotifications.js` module wraps Firebase Cloud Messaging (FCM) for the web app.

### `obtainPushToken()`

Requests a browser push subscription and returns the FCM registration token.

**Returns:** `Promise<string|null>`

**Notes:**
- Registers `firebase-messaging-sw.js` automatically
- Requires `VITE_FIREBASE_VAPID_KEY`

### `revokePushToken(token)`

Deletes the locally stored FCM token.

**Parameters:**
- `token` (string) – Token to revoke

**Returns:** `Promise<boolean>`

### `registerTokenWithServer({ token, timezone, appVersion, authToken })`

Calls the Cloud Function `registerPushToken` so the backend knows about this device.

**Parameters:**
- `token` – FCM token
- `timezone` – IANA timezone string
- `appVersion` – App build version string
- `authToken` – Optional Firebase ID token

**Returns:** `Promise<object>`

### `unregisterTokenWithServer({ token, authToken })`

Removes the token document on the server when the user disables notifications or logs out.

### `sendServerPush({ token, title, body, data, tag, authToken })`

Convenience wrapper around the `sendPushNotification` Cloud Function. Sends a lock-screen friendly push payload.

**Usage Notes:**
- `title` and `body` must be defined or iOS will ignore the push
- `data` accepts simple key/value pairs (strings)
- Returns Cloud Function response payload

## Cloud Functions (functions/index.js)

### `nasaFeed`

`GET /api/nasa-se-feed` proxies the NASA-SE RSS feed to avoid CORS issues.

### `registerPushToken`

`POST /api/register-push-token`

Stores or updates an FCM token document. Body shape:

```json
{
  "token": "string",
  "platform": "web",
  "timezone": "America/New_York",
  "appVersion": "0.1.0"
}
```

Optionally include an `Authorization: Bearer <ID token>` header so the token is linked to a Firebase user ID.

### `unregisterPushToken`

`POST /api/unregister-push-token`

Deletes the Firestore document for a token. Body:

```json
{ "token": "string" }
```

### `sendPushNotification`

`POST /api/send-push-notification`

Dispatches a push message by calling FCM. Body:

```json
{
  "token": "string",
  "title": "HPDE 1 in 5m",
  "body": "Driver's meeting at 09:45",
  "tag": "livegrid-HPDE 1-<timestamp>",
  "data": { "url": "https://livegrid.app/" }
}
```

The function automatically fills in web push metadata (icon, badge, vibration) so the OS can present the notification on the lock screen.
