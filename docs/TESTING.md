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

- Validates structure across all parser fixtures
- Ensures run group extraction is consistent
- Verifies session counts per day

### Parser Fixture Tests

- `nasaSeParser.fixtures.test.js`
- `hodMaParser.fixtures.test.js`

These tests:
- Validate the normalized schedule contract
- Run anomaly checks (warn-first)
- Aggregate warnings and print a summary table

Parser-specific CSV rules live in `docs/PARSERS.md`.

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

1. Add a CSV file to `src/schedule/parsers/<parserId>/fixtures/`.
2. Update `manifest.json` in that folder.
3. Parser fixture tests automatically include it.
4. Add overrides to the manifest if a known anomaly is expected.

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

## Parser Fixture Manifests

Each parser has a `fixtures/manifest.json` file:

```json
{
  "parserId": "nasa-se",
  "fixtures": [
    { "file": "2026 New Year, New Gear - Schedule.csv", "label": "2026 New Year, New Gear" }
  ]
}
```

Optional overrides can be added to a fixture:

- `allowNoClassroom`
- `allowNoMeetings`
- `allowSingleSessionGroup`
- `allowSingleSessionGroups` (array of group names)
- `allowUnknownRunGroups`
- `allowEmptySessions`

## Warn-Only vs Strict Mode

By default, anomaly checks **warn only** and do not fail tests.

To fail tests on anomalies:

```bash
LIVEGRID_TEST_STRICT=1 npm run test:run
```

## Group Taxonomy Tests

Group taxonomy tests ensure related group labels map correctly (e.g., selecting `TT Omega`
should still match a schedule label like "All Time Trial").
