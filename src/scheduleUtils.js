/**
 * Utility functions for parsing and processing NASA racing schedules
 */

// ============================================================================
// TIME UTILITIES - Date and time parsing and formatting
// ============================================================================

/**
 * Parse time string like "8:30 AM" to today's date with that time
 * If AM/PM is not specified, uses smart defaults: 12:xx is PM (noon), otherwise assumes based on context
 */
export function parseTimeToToday(timeStr, dayOffset = 0) {
  if (!timeStr) return null
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i)
  if (!match) return null
  
  let [, hours, minutes, ampm] = match
  hours = parseInt(hours)
  minutes = parseInt(minutes)
  
  // If AM/PM is specified, use it
  if (ampm) {
    if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12
    if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0
  } else {
    // No AM/PM specified: smart defaults for meeting times
    // 12:xx without AM/PM is noon (PM)
    // Times before 8 AM are assumed to be PM (like 1:00 = 1:00 PM)
    // Times 8:00 - 11:59 are assumed to be AM
    if (hours === 12) {
      hours = 12 // noon
    } else if (hours >= 8 && hours < 12) {
      // 8:00 - 11:59 assumed AM (no change needed)
    } else if (hours < 8) {
      // 1:00 - 7:59 assumed PM
      hours += 12
    }
    // hours >= 13 are already in 24-hour format, no change needed
  }
  
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  
  if (dayOffset !== 0) {
    date.setTime(date.getTime() + dayOffset * 86400000)
  }
  
  return date
}

/**
 * Add minutes to a date
 */
export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

/**
 * Check if a CSV row represents a time-based entry
 */
export function isTimeRow(row) {
  if (!row || row.length === 0) return false
  const firstCol = (row[0] || '').toString().trim()
  return /\d{1,2}(:\d{2})?\s*(AM|PM|am|pm)?/.test(firstCol)
}

// ============================================================================
// FILTERING UTILITIES - Session classification and prioritization
// ============================================================================

/**
 * Determine if a session should be displayed as an on-track session
 * Track column always shows what's on track, so just check if it has content
 * Also filter out zero-duration sessions (placeholder/info rows)
 */
export function isOnTrackSession(session) {
  // Include any session that has content in the Track column and non-zero duration
  return session.session && session.session.trim().length > 0 && session.duration > 0
}

/**
 * Get priority for session deduplication
 */
export function getSessionPriority(sessionName) {
  if (/Lunch/i.test(sessionName)) return 1
  if (/HPDE\s*\d+/i.test(sessionName)) return 2
  if (/HPDE/i.test(sessionName)) return 3
  if (/TT|Race/i.test(sessionName)) return 4
  return 5
}

/**
 * Deduplicate sessions at the same time, keeping higher priority
 */
export function deduplicateSessions(sessions) {
  const timeMap = new Map()
  
  sessions.forEach(session => {
    if (!session.start) return
    const timeKey = session.start.getTime()
    const existing = timeMap.get(timeKey)
    
    if (!existing) {
      timeMap.set(timeKey, session)
    } else {
      const existingPriority = getSessionPriority(existing.session)
      const newPriority = getSessionPriority(session.session)
      
      if (newPriority < existingPriority) {
        timeMap.set(timeKey, session)
      }
    }
  })
  
  return Array.from(timeMap.values()).sort((a, b) => a.start - b.start)
}

// ============================================================================
// RUN GROUP UTILITIES - Extracting and normalizing run groups
// ============================================================================

/**
 * Check if a session name should be excluded from run group extraction
 */
export function shouldExcludeFromRunGroups(sessionName) {
  if (!sessionName || /Lunch/i.test(sessionName)) return true
  if (/ALL\s+RACERS\s+WARMUP/i.test(sessionName)) return true
  if (/MEETING/i.test(sessionName)) return true
  if (/Instructors/i.test(sessionName)) return true
  if (/Awards/i.test(sessionName)) return true
  if (/TT\s+ALL/i.test(sessionName)) return true
  if (/TT\s+Drivers/i.test(sessionName)) return true
  return false
}

/**
 * Extract and normalize run groups from sessions
 */
export function extractRunGroups(sessions) {
  const groupSet = new Set(['All'])
  
  sessions.forEach(session => {
    const sessionName = session.session || ''
    
    if (shouldExcludeFromRunGroups(sessionName)) return
    
    // Handle combined sessions with "&" - split and add each part
    if (sessionName.includes('&') && !/TT.*Alpha|TT.*Omega|Thunder|Lightning/i.test(sessionName)) {
      const parts = sessionName.split('&').map(p => p.trim())
      parts.forEach(part => {
        // Skip parts that are just numbers (like "3" or "4" from "HPDE 4* & 3")
        if (/^\d+\*?$/.test(part)) return
        
        if (!shouldExcludeFromRunGroups(part)) {
          // Extract HPDE numbers from this part
          const hpdeMatches = [...part.matchAll(/HPDE\s*\d+/ig)]
          if (hpdeMatches.length > 0) {
            hpdeMatches.forEach(match => groupSet.add(match[0].toUpperCase().replace(/\s+/g, ' ')))
          } else {
            groupSet.add(part)
          }
        }
      })
      return
    }
    
    // Extract ALL HPDE numbers from the session name (handles combined sessions like "HPDE 3* & 4")
    const hpdeMatches = [...sessionName.matchAll(/HPDE\s*\d+/ig)]
    if (hpdeMatches.length > 0) {
      hpdeMatches.forEach(match => groupSet.add(match[0].toUpperCase().replace(/\s+/g, ' ')))
      return
    }
    
    // Normalize race names
    let normalized = sessionName
    if (sessionName.includes('Thunder')) normalized = 'Thunder Race'
    else if (sessionName.includes('Lightning')) normalized = 'Lightning Race'
    else if (sessionName.includes('Mock Race')) normalized = 'Mock Race'
    else if (/TT.*Alpha|TTU\/a/i.test(sessionName)) normalized = 'TT Alpha'
    else if (/TT.*Omega|TTU\/b/i.test(sessionName)) normalized = 'TT Omega'
    
    groupSet.add(normalized)
  })
  
  const groups = Array.from(groupSet)
  return ['All', ...groups.slice(1).sort((a, b) => a.localeCompare(b))]
}

/**
 * Apply common typo corrections to session names
 */
export function fixSessionNameTypos(sessionName) {
  if (!sessionName) return sessionName
  return sessionName.replace(/HDPE/gi, 'HPDE')
}
