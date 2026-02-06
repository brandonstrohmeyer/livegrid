import { nasaSeParser } from './nasaSeParser.js'

export const SCHEDULE_PARSERS = [nasaSeParser]
export const DEFAULT_SCHEDULE_PARSER_ID = SCHEDULE_PARSERS[0]?.id || 'nasa-se'

export function getParserById(parserId) {
  if (!parserId) return SCHEDULE_PARSERS[0] || null
  return SCHEDULE_PARSERS.find(parser => parser.id === parserId) || SCHEDULE_PARSERS[0] || null
}

export function parseCsvSchedule({ csvText, parserId = DEFAULT_SCHEDULE_PARSER_ID, dayOffset = 0 }) {
  const parser = getParserById(parserId)
  if (!parser) {
    throw new Error('No schedule parsers are available.')
  }
  return parser.parseCsv({ csvText, dayOffset })
}
