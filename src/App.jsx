import React, { useEffect, useState, useMemo, useRef } from 'react'
import Papa from 'papaparse'
import {
  parseTimeToToday,
  addMinutes,
  isTimeRow,
  isOnTrackSession,
  getSessionPriority,
  deduplicateSessions,
  shouldExcludeFromRunGroups,
  extractRunGroups,
  fixSessionNameTypos
} from './scheduleUtils.js'

// ============================================================================
// MEETING EXTRACTION - Find relevant meetings for selected groups
// ============================================================================

/**
 * Find meetings relevant to the selected run groups
 */
function findRelevantMeetings(allRows, selectedDay, selectedGroups, dayOffset = 0) {
  if (selectedGroups.includes('All') || selectedGroups.length === 0) return []
  
  const meetings = []
  
  // HPDE Meeting
  const hasHPDE = selectedGroups.some(g => g.includes('HPDE'))
  if (hasHPDE) {
    const hpdeMeeting = allRows.find(r => 
      r.day === selectedDay && 
      (r.session || '').toLowerCase().includes('hpde meeting')
    )
    if (hpdeMeeting) {
      meetings.push({ session: hpdeMeeting.session, start: hpdeMeeting.start })
    }
  }
  
  // TT Drivers Meeting
  const hasTT = selectedGroups.some(g => g.includes('TT'))
  if (hasTT) {
    const ttMeeting = allRows.find(r => 
      r.day === selectedDay && 
      (r.note || '').toLowerCase().includes('tt drivers')
    )
    if (ttMeeting) {
      const timeMatch = ttMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)
      const timeStr = timeMatch ? timeMatch[1].trim() : null
      let start = timeStr ? parseTimeToToday(timeStr) : null
      // Apply day offset to meeting time
      if (start && dayOffset !== 0) {
        start = new Date(start.getTime() + dayOffset * 86400000)
      }
      meetings.push({ session: 'TT Drivers Meeting', customTime: timeStr, start })
    }
  }
  
  // All Racers Meeting
  const hasRace = selectedGroups.some(g => 
    ['Thunder Race', 'Lightning Race', 'Mock Race'].includes(g)
  )
  if (hasRace) {
    const racersMeeting = allRows.find(r => 
      r.day === selectedDay && 
      (r.note || '').toLowerCase().includes('all racers meeting')
    )
    if (racersMeeting) {
      const timeMatch = racersMeeting.note.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i)
      const timeStr = timeMatch ? timeMatch[1].trim() : null
      let start = timeStr ? parseTimeToToday(timeStr) : null
      // Apply day offset to meeting time
      if (start && dayOffset !== 0) {
        start = new Date(start.getTime() + dayOffset * 86400000)
      }
      meetings.push({ session: 'All Racers Meeting', customTime: timeStr, start })
    }
  }
  
  return meetings
}

// ============================================================================
// SESSION QUERIES - Find current and upcoming sessions
// ============================================================================

/**
 * Find the currently active session
 */
function findCurrentSession(sessions, nowWithOffset) {
  return sessions.find(session => {
    if (!session.start) return false
    const end = session.end || addMinutes(session.start, session.duration || 20)
    return nowWithOffset >= session.start && nowWithOffset < end
  }) || null
}

/**
 * Check if a session matches a selected group
 */
function sessionMatchesGroup(sessionName, group) {
  const lowerSession = (sessionName || '').toLowerCase()
  const lowerGroup = group.toLowerCase()
  
  // TT ALL and TT Drivers match both TT Alpha and TT Omega
  if (/tt\s+all|tt\s+drivers/i.test(sessionName)) {
    return lowerGroup.includes('tt alpha') || lowerGroup.includes('tt omega')
  }
  
  // For HPDE groups, extract all numbers from session name and check if group number is in there
  // This handles "HPDE 3* & 4" matching both "HPDE 3" and "HPDE 4"
  if (/hpde\s*\d/i.test(lowerGroup)) {
    const groupNumber = lowerGroup.match(/\d+/)?.[0]
    if (groupNumber && /hpde/i.test(lowerSession)) {
      // Extract all numbers from the session name (after HPDE or standalone digits in combined sessions)
      const allNumbers = lowerSession.match(/\d+/g) || []
      return allNumbers.includes(groupNumber)
    }
  }
  
  // For combined sessions with "&" (like "Test/Tune & Comp School")
  // Check if the group matches any part of the combined session
  if (lowerSession.includes('&')) {
    const parts = lowerSession.split('&').map(p => p.trim())
    return parts.some(part => part.includes(lowerGroup) || lowerGroup.includes(part))
  }
  
  return lowerSession.includes(lowerGroup)
}

/**
 * Find the next upcoming session for selected groups
 */
function findNextSession(sessions, selectedGroups, nowWithOffset) {
  // If 'All' is selected, return next session regardless of group
  if (selectedGroups.includes('All')) {
    return sessions.find(session => 
      session.start && session.start > nowWithOffset
    ) || null
  }
  
  // Filter by selected groups
  const filteredSessions = sessions.filter(session => 
    selectedGroups.some(group => sessionMatchesGroup(session.session, group))
  )
  
  return filteredSessions.find(session => 
    session.start && session.start > nowWithOffset
  ) || null
}

/**
 * Find next session for each selected group
 * Returns object mapping group name to next session
 */
function findNextSessionsPerGroup(sessions, selectedGroups, nowWithOffset) {
  if (selectedGroups.includes('All')) {
    const nextSession = findNextSession(sessions, ['All'], nowWithOffset)
    // Use session name as key instead of 'All' to avoid redundancy
    return nextSession ? { [nextSession.session]: nextSession } : {}
  }
  
  const result = {}
  selectedGroups.forEach(group => {
    const next = findNextSession(sessions, [group], nowWithOffset)
    if (next) result[group] = next
  })
  
  return result
}

// ============================================================================
// FORMATTING UTILITIES - Display helpers
// ============================================================================

/**
 * Format time with small superscript AM/PM
 */
function formatTimeWithAmPm(date) {
  if (!date) return ''
  const hours = date.getHours() % 12 || 12
  const mins = String(date.getMinutes()).padStart(2, '0')
  const ampm = date.getHours() >= 12 ? 'PM' : 'AM'
  return (
    <>
      {hours}:{mins}
      <span style={{fontSize: '0.55em', verticalAlign: 'baseline', marginLeft: '0.1em'}}>
        {ampm}
      </span>
    </>
  )
}

/**
 * Format countdown timer (e.g., "2h 15m" or "45m")
 * Shows "now" if session is currently active
 */
function formatTimeUntil(milliseconds, session, nowWithOffset) {
  if (milliseconds <= 0 && session) {
    // Check if we're within the session window
    const end = session.end || addMinutes(session.start, session.duration || 20)
    if (nowWithOffset >= session.start && nowWithOffset < end) {
      return 'now'
    }
    return '0m'
  }
  
  const totalMinutes = Math.ceil(milliseconds / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function App() {
  // State management
  const [rows, setRows] = useState([])
  const [allRows, setAllRows] = useState([])
  const [clockOffset, setClockOffset] = useState(0)
  const [dayOffset, setDayOffset] = useState(0)
  const [now, setNow] = useState(new Date())
  const [selectedGroups, setSelectedGroups] = useState(['All'])
  const [selectedDay, setSelectedDay] = useState(null)
  const [lastFetch, setLastFetch] = useState(null)
  const [currentDay, setCurrentDay] = useState(null)
  const [availableDays, setAvailableDays] = useState([])
  const [debugMode, setDebugMode] = useState(false)
  const [runGroupsExpanded, setRunGroupsExpanded] = useState(false)
  const [selectedCsvFile, setSelectedCsvFile] = useState('schedule.csv')
  
  // Refs for scrolling
  const listRef = useRef(null)
  const itemRefs = useRef({})
  
  // Clock updates
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  
  // Computed effective time with debug offsets
  const nowWithOffset = useMemo(() => {
    return new Date(now.getTime() + clockOffset * 60000 + dayOffset * 86400000)
  }, [now, clockOffset, dayOffset])
  
  // Fetch and parse schedule
  async function fetchSchedule() {
    try {
      const csvPath = selectedCsvFile === 'schedule.csv' ? '/schedule.csv' : `/test-schedules/${selectedCsvFile}`
      const response = await fetch(csvPath)
      const text = await response.text()
      const parsed = Papa.parse(text, { skipEmptyLines: true })
      
      // Parse all rows with day context
      const allRows = []
      let currentDay = null
      
      parsed.data.forEach(row => {
        const firstCol = (row[0] || '').toString().trim().toLowerCase()
        
        // Detect day section headers
        if (firstCol.includes('friday')) currentDay = 'Friday'
        else if (firstCol.includes('saturday')) currentDay = 'Saturday'
        else if (firstCol.includes('sunday')) currentDay = 'Sunday'
        
        // Parse time-based rows
        if (isTimeRow(row)) {
          let start = parseTimeToToday(row[0])
          // Adjust start time by day offset so sessions match mocked day
          if (dayOffset !== 0) {
            start = new Date(start.getTime() + dayOffset * 86400000)
          }
          const duration = row[1] && /\d+/.test(row[1]) ? parseInt(row[1], 10) : null
          const end = duration ? addMinutes(start, duration) : null
          
          // Fix common typos in session names
          let sessionName = fixSessionNameTypos((row[2] || '').toString().trim())
          
          // Search for notes across columns (different schedules use different layouts)
          const note = (row[4] || row[5] || '').toString().trim()
          
          allRows.push({
            raw: row,
            start,
            duration,
            end,
            session: sessionName,
            note,
            classroomCell: (row[3] || '').toString().trim(),
            day: currentDay
          })
        }
      })
      
      // Sort by start time
      allRows.sort((a, b) => (a.start && b.start ? a.start - b.start : 0))
      
      // Extract available days
      const days = [...new Set(allRows.filter(r => r.day).map(r => r.day))]
      setAvailableDays(days)
      
      // Auto-select day based on current/mocked time
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const todayName = dayNames[nowWithOffset.getDay()]
      const defaultDay = days.includes(todayName) ? todayName : days[0]
      setSelectedDay(defaultDay)
      
      // Filter and deduplicate sessions for the default day
      const dayRows = allRows.filter(r => r.day === defaultDay)
      const onTrackRows = dayRows.filter(isOnTrackSession)
      const filteredRows = deduplicateSessions(onTrackRows)
      
      setAllRows(allRows)
      setRows(filteredRows)
      setCurrentDay(filteredRows.length > 0 ? filteredRows[0].day : null)
      setLastFetch(new Date())
    } catch (error) {
      console.error('Failed to fetch or parse schedule:', error)
    }
  }
  
  // Auto-refresh schedule every 30 seconds
  useEffect(() => {
    fetchSchedule()
    const timer = setInterval(fetchSchedule, 30000)
    return () => clearInterval(timer)
  }, [dayOffset, selectedCsvFile])
  
  // Update displayed rows when selected day changes
  useEffect(() => {
    if (!selectedDay || allRows.length === 0) return
    
    const dayRows = allRows.filter(r => r.day === selectedDay)
    const onTrackRows = dayRows.filter(isOnTrackSession)
    const filteredRows = deduplicateSessions(onTrackRows)
    
    setRows(filteredRows)
    setCurrentDay(selectedDay)
  }, [selectedDay, allRows])
  
  // Extract run groups from current sessions
  const groups = useMemo(() => extractRunGroups(rows), [rows])
  
  // Find current and upcoming sessions
  const current = useMemo(() => findCurrentSession(rows, nowWithOffset), [rows, nowWithOffset])
  const relevantMeetings = useMemo(() => 
    findRelevantMeetings(allRows, selectedDay, selectedGroups, dayOffset),
    [allRows, selectedDay, selectedGroups, dayOffset]
  )
  const nextSessionsByGroup = useMemo(() => 
    findNextSessionsPerGroup(rows, selectedGroups, nowWithOffset),
    [rows, selectedGroups, nowWithOffset]
  )
  
  // Auto-scroll to current session
  useEffect(() => {
    if (!current) return
    
    const idx = rows.findIndex(r => 
      r.start && current.start && r.start.getTime() === current.start.getTime()
    )
    if (idx === -1) return
    
    const element = itemRefs.current[idx]
    if (element && listRef.current) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    
    // Re-center after 30 seconds
    const timer = setTimeout(() => {
      if (element && listRef.current) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 30000)
    
    return () => clearTimeout(timer)
  }, [current, rows])
  
  // Handle run group selection
  function handleGroupToggle(group) {
    if (group === 'All') {
      setSelectedGroups(prev => 
        prev.length === 1 && prev[0] === 'All' ? [] : ['All']
      )
    } else {
      setSelectedGroups(prev => {
        const withoutAll = prev.filter(g => g !== 'All')
        return withoutAll.includes(group)
          ? withoutAll.filter(g => g !== group)
          : [...withoutAll, group]
      })
    }
  }
  
  // Dynamic sizing based on content density
  const upcomingCount = Object.entries(nextSessionsByGroup).length
  const isCompactMode = upcomingCount > 3
  
  return (
    <div className="container">
      {/* Clock Display */}
      <h1 className="clock" style={{margin: '0 0 20px 0'}}>
        {(() => {
          const hours = nowWithOffset.getHours() % 12 || 12
          const mins = String(nowWithOffset.getMinutes()).padStart(2, '0')
          const secs = String(nowWithOffset.getSeconds()).padStart(2, '0')
          const ampm = nowWithOffset.getHours() >= 12 ? 'PM' : 'AM'
          return <>{hours}:{mins}:{secs}<span className="clock-ampm">{ampm}</span></>
        })()}
      </h1>
      
      {/* Debug Controls */}
      {debugMode && (
        <div className="debug-controls">
          <div style={{marginBottom: '12px', fontSize: '0.9rem', background: '#fffbea', padding: '8px', borderRadius: '4px', border: '1px solid #f0e68c'}}>
            <strong>Debug Info:</strong><br/>
            Real time: {now.toLocaleString()}<br/>
            Real day: {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]}<br/>
            Mocked time: {nowWithOffset.toLocaleString()}<br/>
            Mocked day: {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][nowWithOffset.getDay()]}<br/>
            Selected day: {selectedDay || 'None'}<br/>
            Day offset: {dayOffset} days<br/>
            Current session: {current ? current.session : 'None'}<br/>
            First session date: {rows.length > 0 && rows[0].start ? rows[0].start.toLocaleString() : 'None'}<br/>
            First session day: {rows.length > 0 && rows[0].start ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][rows[0].start.getDay()] : 'None'}
          </div>
          
          <label htmlFor="csv-file">Schedule File:</label>
          <select
            id="csv-file"
            value={selectedCsvFile}
            onChange={e => setSelectedCsvFile(e.target.value)}
            style={{padding: '6px', marginRight: '16px', minWidth: '250px'}}
          >
            <option value="schedule.csv">schedule.csv (default)</option>
            <option value="2024 Brady Memorial - Schedule.csv">2024 Brady Memorial</option>
            <option value="2024 Santa's Toy Run - Schedule.csv">2024 Santa's Toy Run</option>
            <option value="2024 Savannah Sizzler - Schedule.csv">2024 Savannah Sizzler</option>
            <option value="2025 Brady Skelebration - Schedule.csv">2025 Brady Skelebration</option>
            <option value="2025 Flatten The Curve - Schedule.csv">2025 Flatten The Curve</option>
            <option value="2025 Santa's Toy Run - Schedule.csv">2025 Santa's Toy Run</option>
            <option value="2025 Sinko De Mayo - Schedule.csv">2025 Sinko De Mayo</option>
            <option value="2025 Spring Brake - Schedule.csv">2025 Spring Brake</option>
            <option value="2025 Winter Meltdown - Schedule.csv">2025 Winter Meltdown</option>
            <option value="2026 New Year, New Gear - Schedule.csv">2026 New Year, New Gear</option>
          </select>
          
          <label htmlFor="clock-offset">Clock Offset (min):</label>
          <input
            id="clock-offset"
            type="number"
            min={-720}
            max={720}
            step={1}
            value={clockOffset}
            onChange={e => setClockOffset(Number(e.target.value))}
          />
          <button
            type="button"
            onClick={() => setClockOffset(0)}
            disabled={clockOffset === 0}
          >
            Reset
          </button>
          
          <label htmlFor="day-offset" style={{marginLeft: '16px'}}>Day Offset (days):</label>
          <input
            id="day-offset"
            type="number"
            min={-7}
            max={7}
            step={1}
            value={dayOffset}
            onChange={e => setDayOffset(Number(e.target.value))}
          />
          <button
            type="button"
            onClick={() => setDayOffset(0)}
            disabled={dayOffset === 0}
          >
            Reset
          </button>
        </div>
      )}
      
      <div className="content">
        {/* Left Side: Session List */}
        <aside className="left">
          <h2 style={{margin: 0, marginBottom: '8px'}}>Sessions</h2>
          
          <div style={{display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px'}}>
            <label style={{fontWeight: 600}}>Day:</label>
            <select 
              value={selectedDay || ''} 
              onChange={e => setSelectedDay(e.target.value)} 
              style={{padding: '6px 8px', fontSize: '1rem'}}
            >
              {availableDays.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          
          <div className="session-list" ref={listRef}>
            {rows.map((r, idx) => {
              const isNow = current && r.start && current.start && 
                           r.start.getTime() === current.start.getTime()
              const end = r.end || addMinutes(r.start, r.duration || 20)
              const status = r.start && end && end < nowWithOffset ? 'past' : 
                            isNow ? 'now' : 'future'
              
              return (
                <div
                  key={idx}
                  ref={el => (itemRefs.current[idx] = el)}
                  className={`session ${status}`}
                >
                  <div className="time">{r.start ? formatTimeWithAmPm(r.start) : ''}</div>
                  <div className="title">{r.session}</div>
                  <div className="dur">{r.duration ? `${r.duration}m` : ''}</div>
                </div>
              )
            })}
          </div>
        </aside>
        
        {/* Right Side: Run Groups, Meetings, Upcoming */}
        <section className="right">
          {/* Run Groups Selector */}
          <div style={{marginBottom: '12px'}}>
            <label 
              onClick={() => setRunGroupsExpanded(!runGroupsExpanded)}
              style={{cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.8rem', fontWeight: 700, margin: 0}}
            >
              <span style={{fontSize: '0.7rem'}}>{runGroupsExpanded ? '▼' : '▶'}</span>
              Run Groups
            </label>
            {!runGroupsExpanded && selectedGroups.length > 0 && (
              <div style={{marginTop: '8px', fontSize: '0.95rem', color: '#666', fontWeight: 500}}>
                {selectedGroups.join(', ')}
              </div>
            )}
          </div>
          
          {runGroupsExpanded && (
            <div className="controls" style={{padding: '12px 16px', marginBottom: '12px'}}>
              <div className="checkbox-group">
                {groups.map(g => (
                  <label key={g} className="checkbox-label" style={{fontSize: '1rem', padding: '4px 8px'}}>
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(g)}
                      onChange={() => handleGroupToggle(g)}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </div>
          )}
          
          {/* Meetings */}
          {relevantMeetings.map((meeting, idx) => {
            const isFuture = meeting.start && nowWithOffset <= addMinutes(meeting.start, 10)
            if (!isFuture) return null
            
            return (
              <div 
                key={idx} 
                className="meeting" 
                style={{
                  padding: isCompactMode ? '6px 8px' : undefined,
                  fontSize: isCompactMode ? '0.85rem' : undefined,
                  marginTop: isCompactMode ? '4px' : undefined
                }}
              >
                <div style={{fontSize: isCompactMode ? '0.9rem' : undefined}}>
                  {meeting.session} — {meeting.start ? formatTimeWithAmPm(meeting.start) : meeting.customTime}
                </div>
                <div 
                  className="countdown" 
                  style={{
                    fontSize: isCompactMode ? '0.8rem' : undefined,
                    marginTop: isCompactMode ? '2px' : undefined
                  }}
                >
                  Starts in {formatTimeUntil(meeting.start - nowWithOffset, meeting, nowWithOffset)}
                </div>
              </div>
            )
          })}
          
          {/* Upcoming Sessions */}
          {upcomingCount > 0 && (
            <>
              <h3 style={{
                marginTop: isCompactMode ? '12px' : '20px',
                marginBottom: isCompactMode ? '6px' : '10px',
                fontSize: isCompactMode ? '1.1rem' : '1.3rem'
              }}>
                Upcoming
              </h3>
              
              <div className="next-group-container">
                {Object.entries(nextSessionsByGroup)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([group, session]) => {
                    const padding = upcomingCount === 1 ? '1.4rem 1.8rem' : 
                                   upcomingCount === 2 ? '1.1rem 1.4rem' : 
                                   upcomingCount === 3 ? '0.9rem 1.1rem' : '0.7rem 0.9rem'
                    const fontSize = upcomingCount === 1 ? '1.1rem' : 
                                    upcomingCount === 2 ? '1.05rem' : 
                                    upcomingCount === 3 ? '1rem' : '0.95rem'
                    const strongSize = upcomingCount === 1 ? '1.2rem' : 
                                      upcomingCount === 2 ? '1.15rem' : 
                                      upcomingCount === 3 ? '1.1rem' : '1.05rem'
                    
                    return (
                      <div key={group} className="next-for-block" style={{padding, fontSize}}>
                        {session ? (
                          <>
                            <div>
                              <strong style={{fontSize: strongSize}}>{session.session}</strong> — {formatTimeWithAmPm(session.start)}
                            </div>
                            <div className="countdown">
                              Starts in {formatTimeUntil(session.start - nowWithOffset, session, nowWithOffset)}
                            </div>
                          </>
                        ) : (
                          <div>
                            <strong style={{fontSize: strongSize}}>{group}</strong>: None scheduled
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </>
          )}
        </section>
      </div>
      
      {/* Footer */}
      <footer>
        <div>Last fetch: {lastFetch ? lastFetch.toLocaleTimeString() : '—'}</div>
        <button 
          type="button" 
          onClick={() => setDebugMode(!debugMode)}
        >
          {debugMode ? 'Hide' : 'Show'} Debug
        </button>
      </footer>
    </div>
  )
}
