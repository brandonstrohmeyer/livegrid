"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedEventEndDate = getCachedEventEndDate;
exports.shouldDeactivateStaleEventCacheEntry = shouldDeactivateStaleEventCacheEntry;
const eventDates_1 = require("./eventDates");
function timestampLikeToDate(value) {
    if (!value)
        return null;
    if (value instanceof Date && !Number.isNaN(value.getTime()))
        return value;
    const candidate = value;
    if (typeof candidate.toDate === 'function') {
        const date = candidate.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    if (typeof candidate.toMillis === 'function') {
        const millis = candidate.toMillis();
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}
function getCachedEventEndDate(data) {
    return timestampLikeToDate(data?.endDate)
        || timestampLikeToDate(data?.startDate)
        || (0, eventDates_1.parseDateKeyToUtcDate)(data?.endDateKey || data?.startDateKey);
}
function shouldDeactivateStaleEventCacheEntry(data, now, graceMs) {
    return !(0, eventDates_1.isResolvedEventDateRelevant)(getCachedEventEndDate(data), now, graceMs);
}
