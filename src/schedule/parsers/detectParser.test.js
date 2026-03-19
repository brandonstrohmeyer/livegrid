import { describe, it, expect } from 'vitest'
import { detectParserId } from './registry.js'

describe('detectParserId', () => {
  it('detects HOD-MA by header row', () => {
    const csv = `Activity,Time,WHO,Where
Gate Opens,7:00 AM,All,Front Gate
HPDE 1,8:00 AM,A - Novice,Track`
    const result = detectParserId({ csvText: csv })
    expect(result.parserId).toBe('hod-ma')
  })

  it('detects HOD-MA with header variants', () => {
    const csv = `Activity Name,Start Time (ET),Who,Where / Notes
Gate Opens,7:00 AM,All,Front Gate
HPDE 1,8:00 AM,A - Novice,Track`
    const result = detectParserId({ csvText: csv })
    expect(result.parserId).toBe('hod-ma')
  })

  it('detects HOD-MA with start/end headers', () => {
    const csv = `,,Start,End,Notes
Load In,Load-In,5:00 PM,8:00 PM,Gates close at 8pm
,Registration,6:00 PM,7:00 PM,`
    const result = detectParserId({ csvText: csv, sourceLabel: 'AMP Feb 20-22 LIVE Scheduler Template - Friday.csv' })
    expect(result.parserId).toBe('hod-ma')
  })

  it('detects NASA-SE by day/time structure', () => {
    const csv = `Friday,,,,
8:00 AM,20,HPDE 1,,,
8:20 AM,20,HPDE 2,,,
9:00 AM,20,TT ALL,,,
Saturday,,,,
9:00 AM,20,TT Alpha,,,`
    const result = detectParserId({ csvText: csv })
    expect(result.parserId).toBe('nasa-se')
  })

  it('throws when parser cannot be determined', () => {
    const csv = `Name,Value
Foo,Bar`
    expect(() => detectParserId({ csvText: csv })).toThrow(/Unable to determine parser automatically/)
  })
})
