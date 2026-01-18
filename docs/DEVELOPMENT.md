# Development Guide

## Getting Started

### Prerequisites

- Node.js 16+ and npm
- Git

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
npm run test:run     # Run tests once (CI mode)
```

## Development Workflow

### Adding a New Schedule

1. Export schedule as CSV from your source
2. Place in `public/test-schedules/[event-name].csv`
3. Add to dropdown in `App.jsx`:
   ```jsx
   <option value="[event-name].csv">[Display Name]</option>
   ```
4. Tests will automatically validate the schedule

### CSV Format Guidelines

Your CSV must include:

1. **Day Headers**: Rows with "Friday", "Saturday", or "Sunday" in first column
2. **Time Format**: "H:MM AM/PM" or "HH:MM AM/PM"
3. **Duration**: Integer minutes in second column
4. **Track Content**: Session names in third column
5. **Notes**: Meeting times and info in columns 4 or 5

**Example:**
```csv
Friday,,Registration,,,
8:00 AM,30,HPDE 1,,,"On Track"
12:00 PM,60,Lunch,,,"12:00 All Racers Meeting"
```

### Modifying Session Logic

Key files:
- `src/scheduleUtils.js` - Core utilities
- `src/App.jsx` - Main component logic

**Common modifications:**

#### Adding a New Run Group Type

1. Update `extractRunGroups()` in `scheduleUtils.js`
2. Add normalization logic if needed
3. Update tests in `App.test.js`

#### Changing Session Priority

Modify `getSessionPriority()` in `scheduleUtils.js`:
```javascript
export function getSessionPriority(sessionName) {
  if (/Lunch/i.test(sessionName)) return 1
  if (/HPDE\s*\d+/i.test(sessionName)) return 2
  if (/HPDE/i.test(sessionName)) return 3
  if (/TT|Race/i.test(sessionName)) return 4
  return 5
}
```

Lower number = higher priority

#### Adding a New Meeting Type

1. Add detection logic in `findRelevantMeetings()` in `App.jsx`
2. Check for group selection
3. Find meeting in notes
4. Extract and parse time
5. Add to meetings array

### Testing Your Changes

```bash
# Run all tests
npm test

# Run specific test file
npm test App.test.js

# Run tests once
npm run test:run
```

Always ensure tests pass before committing.

## Code Style

### Function Organization

Organize by purpose with clear section comments:

```javascript
// ============================================================================
// TIME UTILITIES - Date and time parsing
// ============================================================================

// ============================================================================
// FILTERING UTILITIES - Session classification
// ============================================================================
```

### Naming Conventions

- **Functions**: `camelCase`, verb-first (`parseTimeToToday`, `findCurrentSession`)
- **Components**: `PascalCase` 
- **Constants**: `UPPER_SNAKE_CASE`
- **Boolean helpers**: `is` or `should` prefix (`isTimeRow`, `shouldExcludeFromRunGroups`)

### Documentation

Use JSDoc for all exported functions:

```javascript
/**
 * Parse time string like "8:30 AM" to today's date with that time
 * If AM/PM is not specified, uses smart defaults
 */
export function parseTimeToToday(timeStr, dayOffset = 0) {
  // ...
}
```

## Debugging

### Debug Mode

Enable via "Show Debug" button in footer:
- **Clock Offset**: Test different times (±12 hours)
- **Day Offset**: Test different days (±7 days)
- **Debug Info**: See real vs mocked time/day

### Common Issues

#### Sessions Not Appearing

1. Check CSV format (time format correct?)
2. Verify day headers are detected
3. Check `isOnTrackSession()` logic
4. Look for console errors

#### Meetings Not Showing

1. Verify correct run group is selected
2. Check note column contains meeting info
3. Verify time can be parsed (test with debug mode)
4. Check meeting is in future with 10-minute window

#### Wrong Current Session

1. Verify clock offset is zero
2. Check session duration is correct
3. Ensure CSV times match expected timezone

### Console Logging

Add strategic logging:

```javascript
console.log('Parsed rows:', rows)
console.log('Current session:', current)
console.log('Meetings found:', relevantMeetings)
console.log('Next sessions:', nextSessionsByGroup)
```

## Performance Considerations

### Expensive Operations

These are memoized with `useMemo`:
- `extractRunGroups()` - Regex matching and sorting
- `findCurrentSession()` - Time comparisons
- `findRelevantMeetings()` - Note searching and time parsing
- `findNextSessionsPerGroup()` - Filtering and sorting

### Update Frequencies

- Clock: 1 second (necessary for live updates)
- Schedule fetch: 30 seconds (reasonable for live changes)
- Auto-scroll: 30 seconds (balances user control and automation)

Don't reduce these unless you have specific performance issues.

## Building for Production

```bash
npm run build
```

Output in `dist/` directory. Deploy this folder to your web server.

### Deployment Options

1. **Static hosting**: GitHub Pages, Netlify, Vercel
2. **Web server**: nginx, Apache
3. **Kiosk mode**: Chrome in full-screen on dedicated hardware

### Kiosk Setup

For paddock display:

1. Use Chrome in kiosk mode: `chrome --kiosk --app=http://your-url`
2. Disable screen sleep in OS settings
3. Set schedule to auto-fetch (already configured at 30s)
4. Consider auto-reloading page daily to prevent memory issues

## Contributing

1. Create a feature branch from `develop`
2. Make your changes
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit pull request to `develop`

## Getting Help

- Check existing issues on GitHub
- Review documentation in `/docs`
- Examine test files for usage examples
