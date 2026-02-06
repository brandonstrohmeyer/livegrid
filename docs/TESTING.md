# Testing Documentation

## Running Tests

```bash
# Run all tests
npm test

# Run tests once (CI mode)
npm run test:run
```

## Test Structure

### Unit Tests (App.test.js)

- CSV parsing (day detection, time parsing, durations)
- Session filtering and deduplication
- Run group extraction and normalization
- Meeting detection for all days
- Session matching rules

### Multi-Schedule Tests (MultiSchedule.test.js)

- Validates structure across all test schedules
- Ensures run group extraction is consistent
- Verifies session counts per day

## Key Test Scenarios

### Time Parsing Without AM/PM

```javascript
parseTimeToToday('12:15') // 12:15 PM (noon)
parseTimeToToday('11:30') // 11:30 AM
parseTimeToToday('1:30')  // 1:30 PM
```

### Session Priority

```javascript
// 9:00 AM
'HPDE 1' (priority 2) + 'HPDE' (priority 3) -> Keep 'HPDE 1'

// 12:00 PM
'Lunch' (priority 1) + 'HPDE 2' (priority 2) -> Keep 'Lunch'
```

## Notification Delivery Checklist (Manual)

Push notifications are not covered by automated tests. Validate manually after notification changes:

1. Enable notifications in the sidebar and confirm the success toast appears.
2. Trigger "Test notification" and verify an alert arrives on a device.
3. Disable notifications and confirm no further pushes arrive.
4. Repeat on at least one additional browser or device.

## Writing New Tests

### Testing New Schedules

1. Add a CSV file to `public/test-schedules/`.
2. The meeting parsing test automatically includes it.
3. Verify output shows correct meeting times.

### Testing Session Matching

```javascript
it('matches [group] with [session]', () => {
  expect(sessionMatchesGroup('session name', 'group name')).toBe(true)
})

it('does not match [group] with [session]', () => {
  expect(sessionMatchesGroup('session name', 'group name')).toBe(false)
})
```

## Known Test Limitations

1. Date dependencies (tests use `new Date()`; timezone can affect output)
2. File system access (tests load CSV files from disk)
3. Browser environment (jsdom only)

## Future Test Improvements

- Add component rendering tests
- Add interaction tests (clicks, selections)
- Mock date/time for deterministic outputs
- Add visual regression tests
