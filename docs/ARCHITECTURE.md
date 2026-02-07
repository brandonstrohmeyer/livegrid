# Architecture Documentation

## Overview

The NASA Session Dashboard is a single-page React application that displays real-time racing schedules with live session tracking, meeting notifications, run group filtering, and optional account sync.

## Technology Stack

- React 19 (hooks)
- Vite 5 (build + dev server)
- Vite PWA (service worker + manifest)
- Firebase 11 (Auth, Firestore, Cloud Messaging)
- React Pro Sidebar (sidebar layout)
- PapaParse (CSV parsing)
- Vitest (tests)

## Project Structure

```
nasa-session-dashboard/
  src/
    App.jsx
    components/
      FirebaseAuthUI.jsx
    contexts/
      AuthContext.jsx
      PreferencesContext.jsx
    firebaseClient.js
    pushNotifications.js
    scheduleUtils.js
    schedule/
      parsers/
        nasaSeParser.js
        nasaSeParser.test.js
        nasaSeRules.js
        hodMaParser.js
        hodMaParser.test.js
        hodMaRules.js
        registry.js
        nasa-se/
          fixtures/
          groupTaxonomy.js
        hod-ma/
          fixtures/
          groupTaxonomy.js
      testing/
        anomalyChecks.js
        contract.js
        fixtures.js
        groupMapping.js
      types.js
    styles.css
    App.test.js
    MultiSchedule.test.js
  public/
    schedule.csv
    firebase-messaging-sw.js
    test-schedules/
  docs/
    PARSERS.md
  functions/
  package.json
```

Parser fixtures live under:

```
src/
  schedule/
    parsers/
      nasa-se/
        fixtures/
```

Parser rules and CSV format details are documented in `docs/PARSERS.md`.

## Component Architecture

### App.jsx

- Orchestrates the sidebar, schedule display, and right-hand panels.
- Owns most UI state (run groups, day selection, debug panel, notifications, account panel).
- Drives the CSV fetch/parse pipeline and auto-scroll logic.

### FirebaseAuthUI.jsx

- Handles Google, Apple, and email/password sign-in flows.
- Uses Firebase Auth providers (redirect + email/password).
- Shows password reset and account creation toggles.

### AuthContext.jsx

- Tracks Firebase auth state (`user`, `loading`, `error`).
- Sets persistence for PWA / iOS Safari using IndexedDB when possible.
- Exposes `signOut` for the account panel.

### PreferencesContext.jsx

- Stores preferences locally when signed out.
- Syncs preferences to Firestore under `users/{uid}` when signed in.
- Uses a small write buffer so rapid UI changes do not spam Firestore.

## Data Flow

### 1. CSV Parsing Pipeline (Parser Registry)

```
CSV file
  -> Parser registry selects organization parser
  -> Parser reads CSV (PapaParse)
  -> Detect day headers + time rows
  -> Build normalized sessions + activities
  -> Return NormalizedSchedule
```

Parsers are modular and can include organization-specific helpers, fixtures, and taxonomy
metadata for group mapping tests.

### 2. Session Filtering

```
NormalizedSchedule.sessions
  -> Filter by selectedDay
  -> Render in session list
```

### 3. Activity Filtering

```
NormalizedSchedule.activities
  -> Filter by selectedDay + selectedGroups
  -> Render in meetings/classroom list
```

### 4. Preferences Sync

```
Local UI updates
  -> PreferencesContext
  -> Local storage (signed out)
  -> Firestore write (signed in)
```

### 5. Notification Token Lifecycle

```
Enable notifications
  -> Request permission
  -> Obtain FCM token
  -> registerPushToken (Cloud Function)
  -> Store in Firestore
```

## Caching (Sheets)

Sheet data is cached in the Functions layer only; the client always calls `/api/sheets/...` and never reads Firestore directly.

- **In-memory cache**: Per-function-instance `Map` caches (`sheetMetadataCache`, `sheetValuesCache`). Fast but lost on restart. TTLs are set in `functions/src/index.ts` (`SHEETS_METADATA_TTL_MS`, `SHEETS_VALUES_TTL_MS`).
- **Firestore cache**: Persistent cache in `sheetMetadata` and `sheetSources`. Used when in-memory cache misses or expires. Values are stored as `{ cells: [...] }` objects to avoid Firestore nested-array restrictions.
- **Upstream fetch**: If caches miss or are stale, Functions fetch from the Google Sheets API, normalize headers/rows, then write back to Firestore.

## Notification Flow (Client-Driven)

Notifications are scheduled by the client while the app is open. This is not a true background scheduler.

1. User enables notifications.
2. Client requests permission and registers `firebase-messaging-sw.js`.
3. Client obtains FCM token and registers it with Functions.
4. While the app is open, the client evaluates upcoming sessions and sends pushes via Functions.
5. The service worker shows the notification when a push arrives.

Limitations:
- Notifications only schedule while the app is running (foreground or background).
- If the app is fully closed, no notifications are scheduled.

## Key Algorithms

### Session Priority (Deduplication)

1. Lunch (priority 1)
2. HPDE with number (priority 2)
3. Generic HPDE (priority 3)
4. TT or Race (priority 4)
5. Other (priority 5)

### Time Parsing

`parseTimeToToday` smart defaults when AM/PM is missing:
- 12:xx -> noon (PM)
- 8:00 to 11:59 -> AM
- 1:00 to 7:59 -> PM

### Meeting Detection

- HPDE meeting when any HPDE group is selected.
- TT Drivers meeting when any TT group is selected.
- All Racers meeting when any race group is selected.

### Session Matching

- TT ALL matches both TT Alpha and TT Omega.
- TT Drivers matches both TT Alpha and TT Omega.
- Mock Race and All Racers Warmup map to both Thunder and Lightning race groups.
- Combined sessions like "HPDE 3* & 4" match both groups.

## UI Behavior

- Sidebar slides in/out on mobile, collapses on desktop.
- Account panel scrolls internally so it does not overlap lower controls.
- Auth email form auto-scrolls into view when expanded.
- Current session auto-scrolls in the list view.

## Debug Features

- Clock offset (+/- 12 hours)
- Day offset (+/- 7 days)
- Debug panel for time and schedule inspection

## CSV Format Requirements (Parser Modules)

Each parser defines its own CSV rules. See `docs/PARSERS.md` for organization-specific
formats and run group mapping behavior.
