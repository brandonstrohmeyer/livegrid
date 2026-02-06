# Development Guide

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Git
- Firebase project (required for auth, sync, and notifications)

### Installation

```bash
# Clone the repository
git clone https://github.com/brandonstrohmeyer/nasa-session-dashboard.git
cd nasa-session-dashboard

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

## Project Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm test             # Run tests in watch mode
npm run test:ui      # Open Vitest UI
npm run test:run     # Run tests once (CI mode)
```

Version bump options (default is patch):
```bash
npm run build --bump=patch
npm run build --bump=minor
npm run build --bump=major
```

## Environment Variables

Create a `.env.local` (or `.env`) file with your Firebase configuration:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_FIREBASE_VAPID_KEY=...

# Optional when developing against the Functions emulator
VITE_FUNCTIONS_BASE_URL=http://localhost:5001/<project-id>/us-central1
```

Notes:
- `VITE_FIREBASE_VAPID_KEY` is required for web push.
- `VITE_FUNCTIONS_BASE_URL` lets the frontend call the Functions emulator.

## Firebase Services

### Auth + Preferences Sync

- Sign-in supports Google, Apple, and email/password.
- Preferences are stored locally when signed out.
- When signed in, preferences sync to Firestore under `users/{uid}`.

### Cloud Functions + Hosting

Functions power the RSS proxy and push endpoints:

- `POST /api/register-push-token`
- `POST /api/unregister-push-token`
- `POST /api/send-push-notification`

Deploy with:

```bash
firebase deploy --only functions,hosting
```

## Notifications Overview

The notification system is client-driven. The app must remain open (foreground or background) to schedule pushes.

Flow:
1. User enables notifications in the sidebar.
2. Client registers the service worker and obtains an FCM token.
3. Token is registered with Functions and stored in Firestore.
4. While the app runs, upcoming sessions trigger push sends.

## Adding a New Schedule

1. Export schedule as CSV from your source.
2. For the debug UI, place it in `public/test-schedules/[event-name].csv`.
3. Add it to the debug dropdown in `App.jsx` if needed.
4. For automated parser tests, add the file to `src/schedule/parsers/<parserId>/fixtures/` and update the manifest.

## Adding a New Parser

1. Create a new parser module in `src/schedule/parsers/` that returns a `NormalizedSchedule`.
2. Add any organization-specific helpers in a subfolder (e.g., `src/schedule/parsers/<id>/`).
3. Register the parser in `src/schedule/parsers/registry.js`.
4. Add fixtures under `src/schedule/parsers/<id>/fixtures/` and a `manifest.json`.
5. Add a focused parser test under `src/schedule/parsers/`.
6. Document the CSV rules in `docs/PARSERS.md`.

## CSV Format Guidelines

Parser CSV formats are defined per organization. See `docs/PARSERS.md` for details.

Example (NASA-SE):

```csv
Friday,,Registration,,,
8:00 AM,30,HPDE 1,,,"On Track"
12:00 PM,60,Lunch,,,"12:00 All Racers Meeting"
```

## Debug Mode

Enable via the footer button:
- Clock offset (+/- 12 hours)
- Day offset (+/- 7 days)

## Building for Production

```bash
npm run build
```

Output is generated in `dist/`.

## Deployment Options

1. Static hosting (Netlify, Vercel, GitHub Pages)
2. Web server (nginx, Apache)
3. Kiosk mode (Chrome fullscreen)

Kiosk example:

```bash
chrome --kiosk --app=http://your-url
```
