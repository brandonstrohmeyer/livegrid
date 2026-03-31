import { describe, expect, it } from 'vitest'
import { matchCachedEventForSheet, resolveSelectedScheduleState } from './eventResolution.js'

describe('event resolution helpers', () => {
  it('matches cached events by spreadsheet id before raw sheet url', () => {
    const match = matchCachedEventForSheet([
      {
        id: 'nasa:event-1',
        source: 'nasa',
        spreadsheetId: 'TEST_SHEET_ID',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit#gid=999'
      }
    ], {
      customUrl: 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit#gid=123'
    })

    expect(match.matchType).toBe('spreadsheetId')
    expect(match.event?.id).toBe('nasa:event-1')
  })

  it('keeps known-source unresolved events active via floating fallback', () => {
    const state = resolveSelectedScheduleState({
      hasSelectedSchedule: true,
      isLocalDemoScheduleActive: false,
      matchedEvent: {
        id: 'nasa:event-1',
        dateResolved: false
      },
      eventsLookupReady: true,
      anchoredWindowStart: null,
      anchoredWindowEnd: null,
      now: new Date('2026-03-31T12:00:00')
    })

    expect(state.status).toBe('unresolved')
    expect(state.isScheduleActive).toBe(true)
    expect(state.useFloatingFallback).toBe(true)
  })

  it('keeps unmatched pasted sheets inactive', () => {
    const state = resolveSelectedScheduleState({
      hasSelectedSchedule: true,
      isLocalDemoScheduleActive: false,
      matchedEvent: null,
      eventsLookupReady: true,
      anchoredWindowStart: null,
      anchoredWindowEnd: null,
      now: new Date('2026-03-31T12:00:00')
    })

    expect(state.status).toBe('unmatched')
    expect(state.isScheduleActive).toBe(false)
    expect(state.inactiveReason).toContain('not linked')
  })

  it('derives upcoming, active, and ended states from the anchored event window', () => {
    const base = {
      hasSelectedSchedule: true,
      isLocalDemoScheduleActive: false,
      matchedEvent: {
        id: 'nasa:event-2',
        dateResolved: true,
        startDateKey: '2026-04-03',
        endDateKey: '2026-04-05'
      },
      eventsLookupReady: true,
      anchoredWindowStart: new Date('2026-04-03T08:00:00'),
      anchoredWindowEnd: new Date('2026-04-05T17:00:00')
    }

    expect(resolveSelectedScheduleState({
      ...base,
      now: new Date('2026-04-01T12:00:00')
    }).status).toBe('upcoming')

    expect(resolveSelectedScheduleState({
      ...base,
      now: new Date('2026-04-04T09:15:00')
    }).status).toBe('active')

    expect(resolveSelectedScheduleState({
      ...base,
      now: new Date('2026-04-06T09:15:00')
    }).status).toBe('ended')
  })
})
