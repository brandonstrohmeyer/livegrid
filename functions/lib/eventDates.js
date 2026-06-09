"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDateKey = toDateKey;
exports.parseDateRangeFromText = parseDateRangeFromText;
exports.resolveEventDateRangeFromCandidates = resolveEventDateRangeFromCandidates;
exports.extractHodEventListingsFromOrg = extractHodEventListingsFromOrg;
const MONTH_INDEX = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
};
const MONTH_PATTERN = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const WEEKDAY_PATTERN = '(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)';
function normalizeText(text) {
    return text
        .replace(/\u00A0|\u202F/g, ' ')
        .replace(/\u2013|\u2014/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}
function decodeHtmlEntities(input) {
    return input
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ');
}
function stripHtmlTags(input) {
    return input.replace(/<[^>]+>/g, ' ');
}
function buildUtcDate(year, monthIndex, day) {
    return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0));
}
function normalizeYear(rawYear, fallbackYear) {
    const parsed = typeof rawYear === 'number' ? rawYear : rawYear ? parseInt(rawYear, 10) : fallbackYear;
    if (Number.isNaN(parsed))
        return fallbackYear;
    return parsed < 100 ? parsed + 2000 : parsed;
}
function monthNameToIndex(value) {
    if (!value)
        return null;
    const normalized = value.toLowerCase();
    return Object.prototype.hasOwnProperty.call(MONTH_INDEX, normalized)
        ? MONTH_INDEX[normalized]
        : null;
}
function isValidDate(date) {
    return Boolean(date && !Number.isNaN(date.getTime()));
}
function toDateKey(date) {
    if (!isValidDate(date))
        return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function parseDateRangeFromText(text, fallbackDate) {
    if (!text)
        return null;
    const normalized = normalizeText(text);
    const textWithoutWeekdays = normalizeText(normalized.replace(new RegExp(`\\b${WEEKDAY_PATTERN}\\b,?`, 'gi'), ' '));
    const fallbackYear = fallbackDate?.getUTCFullYear?.() ?? fallbackDate?.getFullYear?.() ?? new Date().getUTCFullYear();
    const repeatedMonthRegex = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*-\\s*${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[^0-9]+(\\d{4}))?`, 'i');
    const repeatedMonthMatch = textWithoutWeekdays.match(repeatedMonthRegex);
    if (repeatedMonthMatch) {
        const startMonthIndex = monthNameToIndex(repeatedMonthMatch[1]);
        const endMonthIndex = monthNameToIndex(repeatedMonthMatch[3]);
        const startDay = parseInt(repeatedMonthMatch[2], 10);
        const endDay = parseInt(repeatedMonthMatch[4], 10);
        const year = normalizeYear(repeatedMonthMatch[5], fallbackYear);
        if (startMonthIndex != null && endMonthIndex != null && !Number.isNaN(startDay) && !Number.isNaN(endDay)) {
            return {
                start: buildUtcDate(year, startMonthIndex, startDay),
                end: buildUtcDate(year, endMonthIndex, endDay)
            };
        }
    }
    const singleMonthRegex = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*-\\s*(\\d{1,2})(?:st|nd|rd|th)?)?(?:[^0-9]+(\\d{4}))?`, 'i');
    const singleMonthMatch = textWithoutWeekdays.match(singleMonthRegex);
    if (singleMonthMatch) {
        const monthIndex = monthNameToIndex(singleMonthMatch[1]);
        const startDay = parseInt(singleMonthMatch[2], 10);
        const endDay = singleMonthMatch[3] ? parseInt(singleMonthMatch[3], 10) : startDay;
        const year = normalizeYear(singleMonthMatch[4], fallbackYear);
        if (monthIndex != null && !Number.isNaN(startDay) && !Number.isNaN(endDay)) {
            return {
                start: buildUtcDate(year, monthIndex, startDay),
                end: buildUtcDate(year, monthIndex, endDay)
            };
        }
    }
    const repeatedNumericRegex = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*-\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/i;
    const repeatedNumericMatch = normalized.match(repeatedNumericRegex);
    if (repeatedNumericMatch) {
        const startMonth = parseInt(repeatedNumericMatch[1], 10);
        const startDay = parseInt(repeatedNumericMatch[2], 10);
        const startYear = normalizeYear(repeatedNumericMatch[3], fallbackYear);
        const endMonth = parseInt(repeatedNumericMatch[4], 10);
        const endDay = parseInt(repeatedNumericMatch[5], 10);
        const endYear = normalizeYear(repeatedNumericMatch[6], startYear);
        if (!Number.isNaN(startMonth) && !Number.isNaN(startDay) && !Number.isNaN(endMonth) && !Number.isNaN(endDay)) {
            return {
                start: buildUtcDate(startYear, Math.min(Math.max(startMonth - 1, 0), 11), startDay),
                end: buildUtcDate(endYear, Math.min(Math.max(endMonth - 1, 0), 11), endDay)
            };
        }
    }
    const singleNumericRegex = /\b(\d{1,2})[/-](\d{1,2})(?:(?:\/(\d{2,4}))|(?:-(\d{4})))?(?:\s*-\s*(\d{1,2}))?(?:[/-](\d{2,4}))?/i;
    const singleNumericMatch = normalized.match(singleNumericRegex);
    if (singleNumericMatch) {
        const month = parseInt(singleNumericMatch[1], 10);
        const startDay = parseInt(singleNumericMatch[2], 10);
        const explicitStartYear = singleNumericMatch[3] || singleNumericMatch[4];
        const endDay = singleNumericMatch[5] ? parseInt(singleNumericMatch[5], 10) : startDay;
        const explicitEndYear = singleNumericMatch[6];
        const year = normalizeYear(explicitEndYear || explicitStartYear, fallbackYear);
        if (!Number.isNaN(month) && !Number.isNaN(startDay) && !Number.isNaN(endDay)) {
            return {
                start: buildUtcDate(year, Math.min(Math.max(month - 1, 0), 11), startDay),
                end: buildUtcDate(year, Math.min(Math.max(month - 1, 0), 11), endDay)
            };
        }
    }
    return null;
}
function resolveEventDateRangeFromCandidates(candidates, options = {}) {
    const { fallbackDate, allowFallbackDate = false } = options;
    for (const candidate of candidates) {
        const text = candidate?.text?.trim();
        if (!text)
            continue;
        const range = parseDateRangeFromText(text, fallbackDate);
        if (range) {
            return {
                start: range.start,
                end: range.end,
                dateSource: candidate.source,
                dateResolved: true
            };
        }
    }
    if (allowFallbackDate && isValidDate(fallbackDate)) {
        const start = buildUtcDate(fallbackDate.getUTCFullYear?.() ?? fallbackDate.getFullYear(), fallbackDate.getUTCMonth?.() ?? fallbackDate.getMonth(), fallbackDate.getUTCDate?.() ?? fallbackDate.getDate());
        return {
            start,
            end: start,
            dateSource: 'fallback-date',
            dateResolved: true
        };
    }
    return {
        start: null,
        end: null,
        dateSource: null,
        dateResolved: false
    };
}
function extractDateTextFromContext(text) {
    const normalized = normalizeText(text);
    const patterns = [
        new RegExp(`\\b${WEEKDAY_PATTERN},?\\s+${MONTH_PATTERN}\\s+\\d{1,2}\\s*-\\s*${WEEKDAY_PATTERN},?\\s+${MONTH_PATTERN}\\s+\\d{1,2}(?:[^0-9]+\\d{4})?`, 'i'),
        new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2}\\s*-\\s*${MONTH_PATTERN}\\s+\\d{1,2}(?:[^0-9]+\\d{4})?`, 'i'),
        new RegExp(`\\b${MONTH_PATTERN}\\s+\\d{1,2}\\s*-\\s*\\d{1,2}(?:[^0-9]+\\d{4})?`, 'i'),
        /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\s*-\s*\d{1,2}(?:[/-]\d{1,2})?(?:[/-]\d{2,4})?/i
    ];
    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[0])
            return match[0].trim();
    }
    return null;
}
function extractHodEventListingsFromOrg(html) {
    const listings = [];
    const seen = new Set();
    const hrefRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = hrefRegex.exec(html))) {
        const rawHref = match[1] || '';
        if (!rawHref.includes('/events/'))
            continue;
        const url = new URL(rawHref, 'https://www.motorsportreg.com');
        if (!/\/events\/[^/]+-\d{5,}\/?$/.test(url.pathname))
            continue;
        const eventUrl = `https://www.motorsportreg.com${url.pathname}`;
        if (seen.has(eventUrl))
            continue;
        seen.add(eventUrl);
        const contextStart = Math.max(0, match.index - 800);
        const context = html.slice(contextStart, match.index);
        const contextText = normalizeText(stripHtmlTags(decodeHtmlEntities(context)));
        const dateText = extractDateTextFromContext(contextText);
        listings.push({ eventUrl, dateText });
    }
    return listings;
}
