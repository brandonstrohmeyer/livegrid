# NASA Session Dashboard

A real-time racing schedule dashboard for NASA (National Auto Sport Association) events. Displays live session tracking, meeting notifications, and run group filtering designed for paddock display on kiosks or laptops.

![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)

## Features

- **Live Session Tracking** - Highlights current session with automatic scrolling
- **Run Group Filtering** - Filter by HPDE level, TT groups, or race classes
- **Meeting Notifications** - Automatic detection of relevant meetings (HPDE, TT Drivers, Racers)
- **Lock-Screen Alerts** - Firebase Cloud Messaging push delivery with OS-level notifications
- **Multi-Day Support** - Handles Friday practice, Saturday qualifying, Sunday racing
- **Multiple Schedules** - Quickly switch between different race events
- **Debug Mode** - Time/day offset controls for testing and development

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

## Usage

### For Race Participants

1. Select your run groups (HPDE 1, TT Alpha, Thunder Race, etc.)
2. View upcoming sessions and relevant meetings
3. Current session is highlighted and auto-scrolled
4. Next session countdown shows time until track time

### For Event Organizers

1. Export schedule as CSV with day headers and time columns
2. Add to `public/test-schedules/` or replace `public/schedule.csv`
3. Select from dropdown in UI
4. Display on paddock kiosk/TV

## CSV Format

```csv
Friday,,Registration,,,
8:00 AM,30,HPDE 1,,,"On Track"
9:00 AM,60,HPDE 2,,,
12:00 PM,60,Lunch,,,"12:00 All Racers Meeting"
Saturday,,Qualifying,,,
...
```

**Requirements:**
- Day headers: "Friday", "Saturday", "Sunday" in first column
- Time format: "H:MM AM/PM" or "HH:MM AM/PM"
- Duration: Integer minutes
- Session names in third column
- Meeting notes in columns 4-5

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed CSV guidelines.

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** - Technical design and data flow
- **[Development Guide](docs/DEVELOPMENT.md)** - Setup, workflow, and contributing
- **[API Reference](docs/API.md)** - Function signatures and usage
- **[Testing](docs/TESTING.md)** - Test structure and running tests

## Tech Stack

- React 18.2 with hooks
- Vite 5 (build tool)
- PapaParse (CSV parsing)
- Vitest (testing)

## Development

```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm test             # Run tests in watch mode
npm run test:run     # Run tests once
```

### Web Push Configuration

Lock-screen notifications use Firebase Cloud Messaging (FCM). Configure the following before building for production:

1. **FCM Credentials** – In the Firebase console generate a Web Push certificate and copy the *VAPID key*. Add it to your environment as `VITE_FIREBASE_VAPID_KEY`.
2. **Functions API** – Deploy the included Cloud Functions (requires `firebase deploy --only functions`). These expose:
	- `POST /api/register-push-token`
	- `POST /api/unregister-push-token`
	- `POST /api/send-push-notification`
3. **Hosting Rewrites** – Already provided in `firebase.json`; ensure you deploy Hosting so `/api/*` rewrites resolve.
4. **Local Development** – When running `npm run dev`, set `VITE_FUNCTIONS_BASE_URL` (e.g. `http://localhost:5001/<project>/us-central1`) so the frontend can reach the emulator.

Without these values the UI will fall back to in-page notifications only.

## Testing

Tests validate:
- CSV parsing across 10+ schedules
- Time parsing with/without AM/PM
- Session filtering and deduplication
- Run group extraction and normalization
- Meeting detection for all days

```bash
npm test
```

See [docs/TESTING.md](docs/TESTING.md) for detailed test documentation.

## Deployment

Build for production:

```bash
npm run build
```

Deploy the `dist/` folder to:
- Static hosting (GitHub Pages, Netlify, Vercel)
- Web server (nginx, Apache)
- Kiosk mode (Chrome full-screen)

### Kiosk Setup

For paddock display:

```bash
chrome --kiosk --app=http://your-url
```

- Disable screen sleep in OS
- Auto-fetches schedule every 30 seconds
- Consider daily page reload to prevent memory issues

## Contributing

1. Fork the repository
2. Create a feature branch from `develop`
3. Make your changes with tests
4. Ensure all tests pass
5. Submit pull request to `develop`

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed guidelines.

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

**TL;DR:** You can use, modify, and distribute this code freely, but any derivative works must also be open source under GPL-3.0. No proprietary forks allowed.

## Acknowledgments

- Built for the NASA racing community
- Inspired by the need for better paddock information displays
- Thanks to all contributors and testers

## Support

- **Issues**: [GitHub Issues](https://github.com/brandonstrohmeyer/nasa-session-dashboard/issues)
- **Documentation**: [docs/](docs/)
- **Examples**: See `public/test-schedules/` for sample CSV files
