# Parser Rules

This document describes the modular CSV parser architecture and the organization-specific rules for each parser.

## Overview

Each parser module:
- Reads raw CSV text and returns a `NormalizedSchedule`.
- Normalizes run group labels and activity metadata.
- Lives under `src/schedule/parsers/` and is registered in `src/schedule/parsers/registry.js`.
- Can include fixtures and taxonomy metadata for tests.

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
  - `Mock Race` maps to **both** `Thunder Race` and `Lightning Race`.
  - `All Racers Warmup` maps to **both** `Thunder Race` and `Lightning Race`.
  - `Santa's Toy Run Fun Race` maps to **all race groups**.
- **Toyota**
  - `Toyota`, `Toyota Drivers`, `Toyota Laps` map to `Toyota GR`.
- **Instructor Clinic**
  - `IC` or `Instructor Clinic` maps to `Instructor Clinic`.
- **Test/Tune**
  - `Test & Tune` and `Test/Tune` normalize to `Test/Tune`.

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
