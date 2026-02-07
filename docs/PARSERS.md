# Parser Rules

This document describes the modular CSV parser architecture and the organization-specific rules for each parser.

## Overview

Each parser module:
- Reads raw CSV text and returns a `NormalizedSchedule`.
- Normalizes run group labels and activity metadata.
- Lives under `src/schedule/parsers/` and is registered in `src/schedule/parsers/registry.js`.
- Can include fixtures and taxonomy metadata for tests.

## Automatic Parser Detection (Google Sheets URLs)

When a **custom Google Sheets URL** is used, the app automatically selects a parser by inspecting the CSV structure:

- **HOD-MA** is selected if a header row contains both an **Activity/Event** column and a **Time/Start Time** column.
- **NASA-SE** is selected if the sheet includes at least one **day header** (e.g., Friday/Saturday/Sunday) and at least three **time rows** with numeric durations.

If no parser can be confidently detected, the load fails with:
```
Unable to determine parser automatically. Ensure the sheet matches NASA-SE or HOD-MA formats.
```

Parser fixtures live here:

```
src/schedule/parsers/<parserId>/fixtures/
```

## NASA-SE Parser

- **Parser ID**: `nasa-se`
- **Parser entry**: `src/schedule/parsers/nasaSeParser.js`
- **Rules/helpers**: `src/schedule/parsers/nasaSeRules.js`
- **Group taxonomy (tests)**: `src/schedule/parsers/nasa-se/groupTaxonomy.js`

### CSV Expectations

NASA-SE schedules are expected to follow a general structure:

- **Day headers**: rows that contain `Friday`, `Saturday`, `Sunday` (plus Mon-Thu when present).
- **Time rows**: first column contains a time string (`H:MM AM/PM`, `HH:MM AM/PM`, or `H:MM`).
- **Duration**: second column, integer minutes.
- **Track session title**: third column.
- **Classroom column**: fourth column (used to create classroom activities).
- **Notes**: columns 5+ may contain meeting notes or extra detail.

### Run Group Normalization

The parser normalizes common label variants into a stable set:

- **HPDE**
  - `HPDE 3* & 4` maps to `HPDE 3` and `HPDE 4`.
  - `HPDE-Intro` maps to its own `HPDE-Intro` run group.
- **Time Trial**
  - `TT ALL`, `TT Drivers`, `All Time Trial`, `TT Practice / Warmup`, `TT Laps` map to **both** `TT Alpha` and `TT Omega`.
  - `TT Group A` maps to `TT Alpha`, `TT Group B` maps to `TT Omega`.
- **Race**
  - `Thunder` => `Thunder Race`
  - `Lightning` => `Lightning Race`
  - `All Racers Warmup` maps to **both** `Thunder Race` and `Lightning Race`.
  - `Santa's Toy Run Fun Race` maps to **all race groups**.
- **Toyota**
  - `Toyota`, `Toyota Drivers`, `Toyota Laps` map to `Toyota GR`.
- **Instructor Clinic**
  - `IC` or `Instructor Clinic` maps to `Instructor Clinic`.
- **Test/Tune**
  - `Test & Tune` and `Test/Tune` normalize to `Test/Tune`.
  - `Mock Race` maps to `Test/Tune`.

The final `runGroups` list always includes `All` as the first entry and is sorted afterward.

### Meeting Activities

Meeting activities are derived from the schedule text and notes:

- **HPDE Meeting**: any row matching `HPDE Meeting`.
- **TT Drivers Meeting**: rows containing `TT Drivers`.
- **All Racers Meeting**: rows containing `All Racers Meeting`.

Activities carry the related run group IDs (HPDE groups, TT groups, or race groups).

### Classroom Activities

If the classroom column contains a recognizable run group label (e.g., `HPDE 1`), a classroom activity is created and linked to that group.

### Exclusions

The parser does not create standalone run group labels from:
- `Lunch`
- Meeting rows
- Awards / Instructor-only rows

Combined sessions like `All Racers Warmup` are instead mapped to existing race groups.

### Notes

- The parser is tolerant of missing AM/PM and uses `parseTimeToToday` rules from `scheduleUtils.js`.
- Day ordering can be Fri/Sat/Sun or any other contiguous day block.

## HOD-MA Parser

- **Parser ID**: `hod-ma`
- **Parser entry**: `src/schedule/parsers/hodMaParser.js`
- **Rules/helpers**: `src/schedule/parsers/hodMaRules.js`
- **Group taxonomy (tests)**: `src/schedule/parsers/hod-ma/groupTaxonomy.js`

### CSV Expectations

HOD schedules typically include a header row with:

- **Activity** or **Event**
- **Time** or **Start Time**
- **WHO**
- **Where / Notes** (or **Location / Notes**)

Files are usually single-day schedules. If a day name is not present in the CSV
text, the parser infers the day from the filename (e.g., `Sat`, `Sunday`), else
falls back to `Day 1`.

### Run Group Normalization

Canonical groups:

- `A - Novice`
- `B - Intermediate`
- `C - Advanced`
- `D - Expert`
- `OUT Motorsports`
- `P&P`

Normalization rules:

- `C/D` => `C - Advanced` + `D - Expert`
- `A/B` => `A - Novice` + `B - Intermediate`
- `B+C+D` => `B - Intermediate` + `C - Advanced` + `D - Expert`
- `A1` => `A - Novice`
- `OUT Motorsports` and `P&P` preserved as standalone groups

### Session Classification

**On-track sessions**

- Any row whose `WHO` column includes a run group (A/B/C/D abbreviations, C/D, A/B, OUT, P&P), which normalize to the full labels.
- If `WHO` is missing or does not contain group labels, the parser also looks for run-group
  labels in the Activity text and the Where/Notes column (e.g., Party Mode notes like `B+C+D`).
- Special session names like `Party Mode`, `Happy Hour`, `Shush Session`, and `Charity Parade Laps`
  can be detected from the Activity, WHO, or Where/Notes columns and are used as the session title.
- Special sessions (`Happy Hour`, `Party Mode`, `Shush Session`, `Charity Parade Laps`)
  are treated as on-track sessions, and run groups are derived from `WHO`.

**Classroom activities**

- Rows containing `Classroom`, `Novice`, or `A‑Novice` are classified as classroom.
- Classroom activities are linked to run group `A - Novice`.

**Meeting activities**

- Rows containing `Meeting` or `Breakout Meetings` are classified as meetings.
- If `WHO` indicates **ALL**, the meeting is linked to all run groups.

**Other rows**

- Gate opens, check-in, lunch, dinner, etc. are kept as sessions if they have a time,
  but they do not add run groups unless the `WHO` field contains group labels.
