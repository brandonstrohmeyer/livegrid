# Architecture Documentation

## Overview

The NASA Session Dashboard is a single-page React application that displays real-time racing schedules with live session tracking, meeting notifications, and run group filtering.

## Technology Stack

- **React 18.2** - Component framework with hooks
- **Vite 5** - Build tool and dev server
- **PapaParse 5.4** - CSV parsing library
- **Vitest** - Testing framework

## Project Structure

```
nasa-session-dashboard/
├── src/
│   ├── App.jsx              # Main application component
│   ├── main.jsx             # Application entry point
│   ├── scheduleUtils.js     # Utility functions for schedule processing
│   ├── styles.css           # Global styles
│   ├── App.test.js          # Application tests
│   └── MultiSchedule.test.js # Multi-schedule tests
├── public/
│   ├── schedule.csv         # Default schedule file
│   └── test-schedules/      # Test schedule files
├── docs/                    # Documentation
└── package.json
```

## Component Architecture

### Main Component (App.jsx)

The application uses a single main component with React hooks for state management:

**State Variables:**
- `rows` - Filtered session data for selected day
- `allRows` - Complete parsed schedule data
- `clockOffset` - Debug time offset (minutes)
- `dayOffset` - Debug day offset (days)
- `now` - Current time (updates every second)
- `selectedGroups` - Active run group filters
- `selectedDay` - Currently displayed day
- `availableDays` - Days available in schedule
- `debugMode` - Debug panel visibility
- `runGroupsExpanded` - Run groups selector state
- `selectedCsvFile` - Active schedule file

**Key Effects:**
1. Clock update (1 second interval)
2. Schedule fetch (30 second interval)
3. Day-based row filtering
4. Auto-scroll to current session

## Data Flow

### 1. CSV Parsing Pipeline

```
CSV File
  ↓
Parse with PapaParse
  ↓
Detect day headers (Friday/Saturday/Sunday)
  ↓
Parse time rows (isTimeRow)
  ↓
Create session objects
  - start: Date
  - duration: number
  - end: Date
  - session: string
  - note: string
  - day: string
  ↓
Sort by start time
  ↓
Store in allRows
```

### 2. Session Filtering

```
allRows
  ↓
Filter by selectedDay
  ↓
Filter by isOnTrackSession
  - Include: Sessions with track content
  - Include: Lunch
  - Exclude: Zero duration sessions
  ↓
Deduplicate by time (keep highest priority)
  ↓
Store in rows
```

### 3. Run Group Extraction

```
Filtered sessions
  ↓
Exclude meetings, warmups, lunch
  ↓
Extract HPDE numbers (regex match)
  ↓
Normalize race names (Thunder/Lightning/Mock)
  ↓
Normalize TT groups (Alpha/Omega)
  ↓
Sort: "All" first, then alphabetically
  ↓
Display in UI
```

## Key Algorithms

### Session Priority (for deduplication)

When multiple sessions exist at the same time, priority determines which to keep:

1. Lunch (priority 1)
2. HPDE with number (priority 2)
3. Generic HPDE (priority 3)
4. TT/Race (priority 4)
5. Other (priority 5)

### Time Parsing

The `parseTimeToToday` function handles various time formats:

- With AM/PM: "8:30 AM" → parsed directly
- Without AM/PM:
  - 12:xx → noon (PM)
  - 8:00-11:59 → AM
  - 1:00-7:59 → PM (meeting context)

### Meeting Detection

| Meeting Type | Trigger | Detection Method |
|--------------|---------|------------------|
| HPDE Meeting | HPDE group selected | Session name contains "hpde meeting" |
| TT Drivers Meeting | TT group selected | Note contains "tt drivers" + time |
| All Racers Meeting | Race group selected | Note contains "all racers meeting" + time |

Time extraction regex: `/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i`

### Session Matching

Groups match sessions using flexible logic:

- **Exact match**: "HPDE 2" matches "HPDE 2"
- **Combined sessions**: "HPDE 3" matches "HPDE 3* & 4"
- **Special cases**: 
  - "TT Alpha" and "TT Omega" both match "TT ALL"
  - "TT Alpha" and "TT Omega" both match "TT Drivers Meeting"

## Performance Optimizations

### React.useMemo

Expensive computations are memoized:

```javascript
groups = useMemo(() => extractRunGroups(rows), [rows])
current = useMemo(() => findCurrentSession(rows, nowWithOffset), [rows, nowWithOffset])
relevantMeetings = useMemo(() => findRelevantMeetings(...), [...])
nextSessionsByGroup = useMemo(() => findNextSessionsPerGroup(...), [...])
```

### Update Frequencies

- **Clock**: 1 second (setInterval)
- **Schedule fetch**: 30 seconds (setInterval)
- **Auto-scroll re-center**: 30 seconds (setTimeout)

## UI Responsiveness

### Dynamic Sizing

The UI automatically adjusts based on content density:

```javascript
upcomingCount > 3 → Compact mode
  - Reduced padding
  - Smaller fonts
  - Tighter spacing

Upcoming blocks padding scales:
  1 item: 1.4rem
  2 items: 1.1rem
  3 items: 0.9rem
  4+ items: 0.7rem
```

### Auto-scroll Behavior

1. Find current session in list
2. Scroll to center with smooth animation
3. Re-center after 30 seconds of idle
4. Cancel on component unmount

## Debug Features

Debug mode provides testing capabilities:

- **Clock Offset**: ±12 hours for time testing
- **Day Offset**: ±7 days for multi-day testing
- **Debug Info Panel**: Shows real vs mocked time/day

## CSV Format Requirements

```csv
Time,Duration,Track,Classroom,Toyota,Note
Friday,,,,,
8:00 AM,30,Registration,,,
9:00 AM,60,HPDE 1,,,"On Track"
12:00 PM,60,Lunch,,,"12:00 All Racers Meeting"
```

**Required Elements:**
1. Day headers: Row where first column contains day name
2. Time format: "H:MM AM/PM" or "HH:MM AM/PM"
3. Duration: Integer minutes in second column
4. Notes: Can contain meeting times and descriptions

**Note Column Locations:**
- Searches columns 4 and 5 for robustness
- Different schedules may use different column layouts
