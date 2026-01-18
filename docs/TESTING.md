# Testing Documentation

## Test Setup

The project uses Vitest for testing with the following configuration:

```javascript
// vitest.config.js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.js',
  },
})
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run
```

## Test Structure

### Unit Tests (App.test.js)

#### CSV Parsing Tests
- Day detection (Friday, Saturday, Sunday)
- Time parsing with AM/PM
- Time parsing without AM/PM (smart defaults)
- Duration parsing
- Day offset application

#### Session Filtering Tests
- Track content inclusion
- Lunch inclusion
- Session priority and deduplication

#### Run Group Extraction Tests
- HPDE numbered group extraction
- TT group normalization (Alpha/Omega)
- Race name normalization (Thunder/Lightning/Mock)
- Exclusions (Lunch, Meetings, Warmup, TT ALL, Awards)
- Alphabetical sorting after "All"

#### Meeting Time Parsing Tests
Tests all 10 schedules in `test-schedules/` directory:
- Saturday Racers Meeting
- Saturday TT Drivers Meeting
- Sunday Racers Meeting
- Sunday TT Drivers Meeting

**Test Output Example:**
```
2025 Flatten The Curve - Schedule.csv:
  Saturday Racers Meeting: 12:00 → 12:00:00 PM
  Saturday TT Drivers Meeting: 12:15 → 12:15:00 PM
  Sunday Racers Meeting: 11:30 → 11:30:00 AM
  Sunday TT Drivers Meeting: 11:15 → 11:15:00 AM
```

#### Session Matching Tests
- HPDE combined sessions ("HPDE 3* & 4")
- Test/Tune & Comp School splitting
- TT ALL matching both Alpha and Omega
- TT Drivers matching both Alpha and Omega
- Negative cases (non-matches)

### Multi-Schedule Tests (MultiSchedule.test.js)

Validates consistency across all test schedules:
- Structure validation
- Run group extraction
- Session counts per day

## Test Coverage

Current test suite: **119 tests across 2 files**

### Key Test Scenarios

#### Time Parsing Without AM/PM

Tests the smart defaults for times without AM/PM:
```javascript
parseTimeToToday('12:15') → 12:15 PM (noon)
parseTimeToToday('11:30') → 11:30 AM
parseTimeToToday('1:30')  → 1:30 PM (afternoon context)
```

#### Meeting Detection Across All Schedules

Ensures all schedules properly format meeting times:
- Validates time extraction regex
- Confirms parseTimeToToday handles all formats
- Checks both Saturday and Sunday meetings

#### Session Priority

Tests deduplication logic:
```javascript
// 9:00 AM
'HPDE 1' (priority 2) + 'HPDE' (priority 3) → Keep 'HPDE 1'

// 12:00 PM  
'Lunch' (priority 1) + 'HPDE 2' (priority 2) → Keep 'Lunch'
```

## Writing New Tests

### Test Helper Functions

```javascript
// Parse CSV like the app does
function parseScheduleCSV(csvText, dayOffset = 0) {
  const parsed = Papa.parse(csvText, { skipEmptyLines: true })
  const allRows = []
  let currentDay = null
  
  parsed.data.forEach(row => {
    // Day detection
    const firstCol = (row[0] || '').toString().trim().toLowerCase()
    if (firstCol.includes('friday')) currentDay = 'Friday'
    else if (firstCol.includes('saturday')) currentDay = 'Saturday'
    else if (firstCol.includes('sunday')) currentDay = 'Sunday'
    
    // Time row parsing
    if (isTimeRow(row)) {
      let start = parseTimeToToday(row[0])
      if (start && dayOffset !== 0) {
        start = new Date(start.getTime() + dayOffset * 86400000)
      }
      // ... build session object
      allRows.push({ /* session data */ })
    }
  })
  
  return allRows
}
```

### Testing New Schedules

To add a new test schedule:

1. Add CSV file to `public/test-schedules/`
2. The meeting parsing test automatically includes it
3. Verify output shows correct meeting times

### Testing Session Matching

```javascript
it('matches [group] with [session]', () => {
  expect(sessionMatchesGroup('session name', 'group name')).toBe(true)
})

it('does not match [group] with [session]', () => {
  expect(sessionMatchesGroup('session name', 'group name')).toBe(false)
})
```

## CI/CD Integration

Tests run automatically on:
- Local development (watch mode)
- Pre-commit hooks (recommended)
- CI pipeline (use `npm run test:run`)

## Known Test Limitations

1. **Date dependencies**: Tests use `new Date()` which can vary by timezone
2. **File system access**: Tests load CSV files from disk (not mocked)
3. **Browser environment**: Requires jsdom for DOM APIs

## Future Test Improvements

- [ ] Add component rendering tests
- [ ] Test user interactions (clicks, selections)
- [ ] Mock date/time for deterministic tests
- [ ] Test auto-scroll behavior
- [ ] Test debug mode functionality
- [ ] Add visual regression tests
