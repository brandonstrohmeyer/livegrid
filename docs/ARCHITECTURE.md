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
    styles.css
    App.test.js
    MultiSchedule.test.js
  public/
    schedule.csv
    firebase-messaging-sw.js
    test-schedules/
  docs/
  functions/
  package.json
```

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

### 1. CSV Parsing Pipeline

```
CSV file
  -> Parse with PapaParse
  -> Detect day headers (Friday/Saturday/Sunday)
  -> Parse time rows (isTimeRow)
  -> Build session objects
  -> Sort by start time
  -> Store in allRows
```

### 2. Session Filtering

```
allRows
  -> Filter by selectedDay
  -> Filter by isOnTrackSession
  -> Deduplicate by time (highest priority wins)
  -> Store in rows
```

### 3. Run Group Extraction

```
rows
  -> Exclude meetings, warmups, lunch
  -> Extract HPDE numbers
  -> Normalize race and TT group names
  -> Sort (All first, then alphabetically)
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

## CSV Format Requirements

```csv
Time,Duration,Track,Classroom,Toyota,Note
Friday,,,,,
8:00 AM,30,Registration,,,
9:00 AM,60,HPDE 1,,,"On Track"
12:00 PM,60,Lunch,,,"12:00 All Racers Meeting"
```

Required elements:
1. Day headers in the first column (Friday/Saturday/Sunday)
2. Time format: "H:MM AM/PM" or "HH:MM AM/PM"
3. Duration in minutes (second column)
4. Session names in the third column
5. Meeting notes in columns 4 or 5
