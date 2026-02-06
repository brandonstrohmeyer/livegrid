/**
 * @typedef {Object} NormalizedSession
 * @property {string} session - Display title for the on-track session.
 * @property {string | null} day - Day label (e.g., Friday/Saturday/Sunday).
 * @property {Date | null} start - Start time (local Date).
 * @property {number | null} duration - Duration in minutes.
 * @property {Date | null} end - Calculated end time.
 * @property {string[]} runGroupIds - Run group labels associated with this session.
 * @property {string} note - Freeform note text (if any).
 * @property {string} classroom - Classroom cell text (if any).
 */

/**
 * @typedef {Object} NormalizedActivity
 * @property {'meeting' | 'classroom' | 'other'} type - Activity category.
 * @property {string} title - Display title for the activity.
 * @property {string | null} day - Day label (e.g., Friday/Saturday/Sunday).
 * @property {Date | null} start - Start time (local Date).
 * @property {number | null} duration - Duration in minutes.
 * @property {string[]} relatedRunGroupIds - Run groups this activity is relevant to.
 * @property {string} note - Freeform note text (if any).
 */

/**
 * @typedef {Object} NormalizedSchedule
 * @property {string[]} runGroups - Run group labels (IDs = labels).
 * @property {NormalizedSession[]} sessions - On-track sessions only.
 * @property {NormalizedActivity[]} activities - Meetings, classroom, and related items.
 * @property {string[]} days - Ordered list of days found in the schedule.
 * @property {string[]} warnings - Parse warnings (non-fatal).
 */

/**
 * @typedef {Object} ScheduleParser
 * @property {string} id - Unique parser ID.
 * @property {string} name - Display name for the parser.
 * @property {(params: { csvText: string, dayOffset?: number }) => NormalizedSchedule} parseCsv
 * @property {Object} [groupTaxonomy] - Optional taxonomy metadata used for mapping tests.
 */
