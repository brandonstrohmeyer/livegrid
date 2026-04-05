"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sheetsApi = exports.testDispatchScheduledNotifications = exports.activeUsersTelemetry = exports.scheduledNotificationDispatcher = exports.syncScheduledNotifications = exports.sendPushNotification = exports.unregisterPushToken = exports.registerPushToken = exports.testSeedEventCache = exports.cachedEvents = exports.refreshEventCache = exports.hodMaEvents = exports.nasaFeed = exports.systemHealth = exports.clientTelemetry = void 0;
exports.dispatchScheduledNotifications = dispatchScheduledNotifications;
const admin = __importStar(require("firebase-admin"));
// Use explicit Firestore exports to avoid admin.firestore.FieldValue being undefined in the emulator runtime.
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logging_1 = require("./logging");
admin.initializeApp();
const db = admin.firestore();
const TEST_MODE = process.env.LIVEGRID_TEST_MODE === 'true';
const TEST_FIXTURES_DIR = process.env.LIVEGRID_TEST_FIXTURES_DIR || '';
const useStubMessaging = TEST_MODE && (process.env.LIVEGRID_TEST_MESSAGING || 'stub') === 'stub';
function resolveFixturePath(name) {
    if (!TEST_MODE || !TEST_FIXTURES_DIR)
        return null;
    const baseDir = path_1.default.isAbsolute(TEST_FIXTURES_DIR)
        ? TEST_FIXTURES_DIR
        : path_1.default.resolve(__dirname, '..', '..', TEST_FIXTURES_DIR);
    return path_1.default.join(baseDir, name);
}
function readFixtureText(name) {
    const filePath = resolveFixturePath(name);
    if (!filePath)
        return null;
    try {
        return (0, fs_1.readFileSync)(filePath, 'utf8');
    }
    catch (err) {
        return null;
    }
}
function readFixtureJson(name) {
    const raw = readFixtureText(name);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch (err) {
        return null;
    }
}
function assertTestMode(res) {
    if (TEST_MODE)
        return true;
    res.status(404).json({ error: 'Not found' });
    return false;
}
function createStubMessaging() {
    return {
        async sendEachForMulticast(message) {
            const tokens = Array.isArray(message?.tokens) ? message.tokens : [];
            const responses = tokens.map(token => {
                if (token.includes('invalid')) {
                    return {
                        success: false,
                        error: { code: 'messaging/registration-token-not-registered', message: 'invalid token' }
                    };
                }
                if (token.includes('transient')) {
                    return {
                        success: false,
                        error: { code: 'messaging/internal-error', message: 'transient error' }
                    };
                }
                if (token.includes('fail')) {
                    return {
                        success: false,
                        error: { code: 'messaging/unknown-error', message: 'forced failure' }
                    };
                }
                return {
                    success: true,
                    messageId: `test-${tokenFingerprint(token) || Math.random().toString(36).slice(2, 10)}`
                };
            });
            const successCount = responses.filter(resp => resp.success).length;
            const failureCount = responses.length - successCount;
            return { responses, successCount, failureCount };
        }
    };
}
const messaging = useStubMessaging ? createStubMessaging() : admin.messaging();
const defaultHost = process.env.GCLOUD_PROJECT ? `https://${process.env.GCLOUD_PROJECT}.web.app` : 'https://livegrid.stro.io';
const appPublicUrl = process.env.APP_PUBLIC_URL || defaultHost;
const scheduledCollection = db.collection('scheduledNotifications');
const usersCollection = db.collection('users');
const sheetMetadataCollection = db.collection('sheetMetadata');
const sheetSourcesCollection = db.collection('sheetSources');
const eventCacheCollection = db.collection('eventCache');
const visitorTelemetryCollection = db.collection('visitorTelemetry');
const SCHEDULER_REGION = 'us-central1';
const LEASE_MS = 2 * 60 * 1000;
const DISPATCH_LIMIT = 200;
const NOTIFICATION_TTL_DAYS = 30;
const NOTIFICATION_TTL_MS = NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const IDENTITY_TOOLKIT_ADMIN_BASE = 'https://identitytoolkit.googleapis.com/admin/v2';
// Secret Manager-backed config must win over any stale legacy env var left on the service.
const SHEETS_API_KEY = process.env.SHEETS_API_KEY || process.env.GOOGLE_SHEETS_API_KEY || '';
const SHEETS_METADATA_TTL_MS = 15 * 60 * 1000;
const SHEETS_VALUES_TTL_MS = 30 * 1000;
const SHEETS_DEFAULT_RANGE_END = 'Z';
const SHEETS_WIDE_RANGE_END = 'AZ';
const SHEETS_HEALTH_PROBE_MAX_CANDIDATES = 3;
const SHEETS_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const SHEETS_RATE_LIMIT_MAX = 60;
const HOD_MA_ORG_URL = 'https://www.motorsportreg.com/orgs/hooked-on-driving/mid-atlantic';
const HOD_MA_EVENT_LIMIT = 20;
const HOD_MA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EVENT_CACHE_STALE_DAYS = 14;
const EVENT_CACHE_MAX = 200;
const ACTIVE_USER_WINDOW_MS = 2 * 60 * 1000;
const ACTIVE_USERS_METRIC_TYPE = 'custom.googleapis.com/livegrid/active_users_current';
const ALL_ACTIVE_VISITORS_METRIC_TYPE = 'custom.googleapis.com/livegrid/all_active_visitors_current';
const ANONYMOUS_ACTIVE_VISITORS_METRIC_TYPE = 'custom.googleapis.com/livegrid/anonymous_active_visitors_current';
const UNIQUE_INTERACTING_VISITORS_24H_METRIC_TYPE = 'custom.googleapis.com/livegrid/unique_interacting_visitors_24h';
const PENDING_NOTIFICATION_USERS_METRIC_TYPE = 'custom.googleapis.com/livegrid/users_with_pending_notifications';
const FIRESTORE_GET_ALL_CHUNK_SIZE = 300;
const VISITOR_INTERACTION_WINDOW_MS = 24 * 60 * 60 * 1000;
const VISITOR_TELEMETRY_TTL_DAYS = 30;
const VISITOR_TELEMETRY_TTL_MS = VISITOR_TELEMETRY_TTL_DAYS * 24 * 60 * 60 * 1000;
const CLIENT_TELEMETRY_MAX_BODY_BYTES = 4096;
const CLIENT_TELEMETRY_MAX_INSTANCES = 2;
const CLIENT_TELEMETRY_IP_WINDOW_MS = 60 * 1000;
const CLIENT_TELEMETRY_IP_LIMIT = 60;
const CLIENT_TELEMETRY_FINGERPRINT_WINDOW_MS = 5 * 60 * 1000;
const CLIENT_TELEMETRY_FINGERPRINT_LIMIT = 5;
const CLIENT_TELEMETRY_ALLOWED_EVENT_PREFIXES = [
    'firebase.',
    'auth.',
    'prefs.',
    'schedule.',
    'notifications.',
    'messaging.',
    'events.',
    'auto_reset.',
    'client.',
    'visitor.'
];
const CLIENT_TELEMETRY_ALLOWED_EVENTS = new Set([
    'visitor.opened',
    'visitor.event_selected',
    'visitor.heartbeat'
]);
const CLIENT_TELEMETRY_ALLOWED_SEVERITIES = new Set(['info', 'warn', 'error']);
const CLIENT_TELEMETRY_ALLOWED_INTERACTIONS = new Set(['opened', 'event_selected', 'heartbeat']);
const sheetMetadataCache = new Map();
const sheetValuesCache = new Map();
const sheetMetadataInFlight = new Map();
const sheetValuesInFlight = new Map();
const sheetRateLimit = new Map();
const clientTelemetryIpRateLimit = new Map();
const clientTelemetryFingerprintRateLimit = new Map();
async function authenticate(req) {
    const authHeader = req.get('authorization') || '';
    if (!authHeader.startsWith('Bearer '))
        return null;
    const token = authHeader.substring(7);
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        return decoded.uid;
    }
    catch (err) {
        logging_1.log.warn('auth.verify_failed', undefined, err);
        return null;
    }
}
function sanitizeData(payload = {}) {
    return Object.entries(payload).reduce((acc, [key, value]) => {
        if (value === undefined || value === null)
            return acc;
        acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
        return acc;
    }, {});
}
function tokenFingerprint(token) {
    if (!token)
        return null;
    try {
        return (0, crypto_1.createHash)('sha256').update(token).digest('hex').slice(0, 12);
    }
    catch (err) {
        logging_1.log.warn('auth.token_hash_failed', undefined, err);
        return 'hash_error';
    }
}
function hashIdentifier(value, length = 24) {
    return (0, crypto_1.createHash)('sha256').update(value).digest('hex').slice(0, length);
}
function truncateString(value, maxLength) {
    if (typeof value !== 'string')
        return '';
    return value.trim().slice(0, maxLength);
}
function coerceTelemetryMeta(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const meta = Object.entries(value).reduce((acc, [key, raw]) => {
        const normalizedKey = truncateString(key, 40);
        if (!normalizedKey)
            return acc;
        if (Array.isArray(raw)) {
            const normalizedArray = truncateString(raw.map(item => String(item)).join(','), 120);
            if (normalizedArray)
                acc[normalizedKey] = normalizedArray;
            return acc;
        }
        if (typeof raw === 'boolean' || typeof raw === 'number') {
            acc[normalizedKey] = raw;
            return acc;
        }
        if (typeof raw === 'string') {
            const normalizedValue = truncateString(raw, 120);
            if (normalizedValue)
                acc[normalizedKey] = normalizedValue;
        }
        return acc;
    }, {});
    return Object.keys(meta).length ? meta : undefined;
}
function computeVisitorTelemetryExpiry(now = firestore_1.Timestamp.now()) {
    return firestore_1.Timestamp.fromMillis(now.toMillis() + VISITOR_TELEMETRY_TTL_MS);
}
function rateLimitKey(map, key, limit, windowMs) {
    const now = Date.now();
    const existing = map.get(key);
    if (!existing || existing.resetAt <= now) {
        map.set(key, { count: 1, resetAt: now + windowMs });
        return { limited: false, firstLimited: false };
    }
    existing.count += 1;
    if (existing.count <= limit) {
        return { limited: false, firstLimited: false };
    }
    return { limited: true, firstLimited: existing.count === limit + 1 };
}
function isAllowedClientTelemetryEvent(event) {
    if (CLIENT_TELEMETRY_ALLOWED_EVENTS.has(event))
        return true;
    return CLIENT_TELEMETRY_ALLOWED_EVENT_PREFIXES.some(prefix => event.startsWith(prefix));
}
function parseRequestBody(body) {
    if (!body)
        return null;
    if (typeof body === 'string') {
        return JSON.parse(body);
    }
    if (Buffer.isBuffer(body)) {
        return JSON.parse(body.toString('utf8'));
    }
    if (typeof body === 'object') {
        return body;
    }
    return null;
}
function sanitizeClientTelemetryPayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const payload = raw;
    const event = truncateString(payload.event, 80);
    const severity = truncateString(payload.severity, 10);
    const path = truncateString(payload.path, 160);
    const appVersion = truncateString(payload.appVersion, 40) || null;
    const fingerprint = truncateString(payload.fingerprint, 160);
    const check = truncateString(payload.check, 80) || null;
    const visitorId = truncateString(payload.visitorId, 120);
    const sessionId = truncateString(payload.sessionId, 120);
    const interactionType = truncateString(payload.interactionType, 40);
    if (!event || !severity || !path || !fingerprint || !visitorId || !sessionId)
        return null;
    if (!CLIENT_TELEMETRY_ALLOWED_SEVERITIES.has(severity))
        return null;
    if (!isAllowedClientTelemetryEvent(event))
        return null;
    if (interactionType && !CLIENT_TELEMETRY_ALLOWED_INTERACTIONS.has(interactionType))
        return null;
    const error = payload.error && typeof payload.error === 'object'
        ? {
            message: truncateString(payload.error.message, 240) || undefined,
            name: truncateString(payload.error.name, 80) || undefined,
            code: truncateString(payload.error.code, 60) || undefined
        }
        : undefined;
    return {
        event,
        severity,
        path,
        appVersion,
        fingerprint,
        check,
        visitorId,
        sessionId,
        interactionType: interactionType || undefined,
        error,
        meta: coerceTelemetryMeta(payload.meta)
    };
}
function logClientTelemetryRejection(reason, req, detail) {
    const ip = getClientIp(req);
    logging_1.log.warn('client.telemetry_rejected', {
        reason,
        ipHash: hashIdentifier(ip, 12),
        ...detail
    });
}
async function updateVisitorTelemetry(payload, now = firestore_1.Timestamp.now()) {
    const visitorHash = hashIdentifier(payload.visitorId);
    const sessionHash = hashIdentifier(payload.sessionId);
    const docRef = visitorTelemetryCollection.doc(visitorHash);
    await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        const update = {
            visitorHash,
            lastSessionHash: sessionHash,
            lastSeenAt: now,
            lastAuthState: payload.meta?.authState === 'signed_in' ? 'signed_in' : 'anonymous',
            lastPath: payload.path,
            lastAppVersion: payload.appVersion,
            updatedAt: now,
            expiresAt: computeVisitorTelemetryExpiry(now)
        };
        if (!snap.exists) {
            update.firstSeenAt = now;
        }
        if (payload.interactionType === 'opened' || payload.interactionType === 'event_selected') {
            update.lastInteractionAt = now;
        }
        if (payload.interactionType === 'opened') {
            update.lastOpenedAt = now;
        }
        if (payload.interactionType === 'event_selected') {
            update.lastSelectedEventAt = now;
            update.lastSelectedSource = payload.meta?.source || null;
            update.lastSelectedEventIdHash = payload.meta?.eventId ? hashIdentifier(String(payload.meta.eventId), 16) : null;
        }
        transaction.set(docRef, update, { merge: true });
    });
    return { visitorHash, sessionHash };
}
function logClientTelemetryEvent(payload, identifiers) {
    const baseData = {
        sourceEvent: payload.event,
        severity: payload.severity,
        path: payload.path,
        appVersion: payload.appVersion,
        fingerprint: payload.fingerprint,
        visitorHash: identifiers.visitorHash,
        sessionHash: identifiers.sessionHash,
        check: payload.check || undefined,
        interactionType: payload.interactionType || undefined,
        meta: payload.meta
    };
    if (payload.event === 'visitor.opened') {
        logging_1.log.info('visitor.opened', baseData);
        return;
    }
    if (payload.event === 'visitor.event_selected') {
        logging_1.log.info('visitor.event_selected', baseData);
        return;
    }
    if (payload.event === 'visitor.heartbeat') {
        logging_1.log.debug('visitor.heartbeat', baseData);
        return;
    }
    const isHealthFailure = Boolean(payload.check) || payload.event === 'firebase.config_missing' || payload.event === 'firebase.client_disabled';
    if (isHealthFailure) {
        logging_1.log.error('client.health_failed', baseData, payload.error);
        return;
    }
    if (payload.severity === 'error') {
        logging_1.log.error('client.error', baseData, payload.error);
        return;
    }
    if (payload.severity === 'warn') {
        logging_1.log.warn('client.warn', baseData, payload.error);
        return;
    }
    logging_1.log.info('client.info', baseData, payload.error);
}
function getRuntimeProjectId() {
    return process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || admin.app().options.projectId || '';
}
async function getMetadataAccessToken() {
    const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
        headers: {
            'Metadata-Flavor': 'Google'
        }
    });
    if (!response.ok) {
        throw new Error(`Metadata token request failed (${response.status})`);
    }
    const payload = await response.json();
    if (!payload?.access_token) {
        throw new Error('Metadata token response missing access_token');
    }
    return payload.access_token;
}
async function writeGaugeMetrics(metrics, now = firestore_1.Timestamp.now()) {
    if (TEST_MODE || process.env.FUNCTIONS_EMULATOR === 'true')
        return;
    const projectId = getRuntimeProjectId();
    if (!projectId) {
        logging_1.log.warn('presence.metric_project_missing');
        return;
    }
    try {
        const accessToken = await getMetadataAccessToken();
        const endTime = new Date(now.toMillis()).toISOString();
        const timeSeries = metrics
            .filter(metric => Number.isFinite(metric.value))
            .map(metric => ({
            metric: {
                type: metric.type
            },
            resource: {
                type: 'global',
                labels: {
                    project_id: projectId
                }
            },
            points: [
                {
                    interval: {
                        startTime: endTime,
                        endTime
                    },
                    value: {
                        int64Value: String(Math.max(0, Math.trunc(metric.value)))
                    }
                }
            ]
        }));
        if (!timeSeries.length)
            return;
        const response = await fetch(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                timeSeries
            })
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Monitoring write failed (${response.status}): ${text}`);
        }
    }
    catch (err) {
        logging_1.log.warn('presence.metric_write_failed', {
            metrics: metrics.map(metric => ({ type: metric.type, value: metric.value }))
        }, err);
    }
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
function extractEventLinksFromOrg(html) {
    const links = new Set();
    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match;
    while ((match = hrefRegex.exec(html))) {
        const rawHref = match[1] || '';
        if (!rawHref.includes('/events/'))
            continue;
        const url = new URL(rawHref, 'https://www.motorsportreg.com');
        if (!/\/events\/[^/]+-\d{5,}\/?$/.test(url.pathname))
            continue;
        links.add(`https://www.motorsportreg.com${url.pathname}`);
    }
    return Array.from(links);
}
function extractSheetUrlFromHtml(html) {
    const match = html.match(/https?:\/\/docs\.google\.com\/spreadsheets\/[^\s"'<>]+/i);
    if (!match)
        return null;
    return decodeHtmlEntities(match[0]);
}
function titleFromEventUrl(eventUrl) {
    try {
        const url = new URL(eventUrl);
        const parts = url.pathname.split('/events/');
        const slug = parts[1] || '';
        const cleaned = slug.replace(/-\d{5,}\/?$/, '').replace(/[-_]+/g, ' ').trim();
        if (!cleaned)
            return 'Event';
        return cleaned
            .split(' ')
            .map(word => (word.length <= 3 ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
            .join(' ');
    }
    catch (err) {
        return 'Event';
    }
}
function extractEventTitle(html, fallbackUrl) {
    const ogMatch = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogMatch?.[1])
        return decodeHtmlEntities(ogMatch[1]).trim();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch?.[1])
        return decodeHtmlEntities(titleMatch[1]).trim();
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (h1Match?.[1])
        return decodeHtmlEntities(h1Match[1]).trim();
    return titleFromEventUrl(fallbackUrl);
}
function stripCdata(value) {
    return value.replace(/^<!\[CDATA\[/i, '').replace(/\]\]>$/i, '').trim();
}
function extractXmlTag(xml, tag) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    if (!match?.[1])
        return null;
    return stripCdata(match[1]).trim();
}
function extractPreferredSheetUrlFromHtml(html) {
    if (!html)
        return null;
    const anchorRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(html))) {
        const href = match[1] || '';
        const text = decodeHtmlEntities(match[2] || '').toLowerCase();
        if (!href.includes('docs.google.com/spreadsheets'))
            continue;
        if (text.includes('live') && text.includes('schedule')) {
            return decodeHtmlEntities(href);
        }
    }
    return extractSheetUrlFromHtml(html);
}
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
function buildUtcDate(year, monthIndex, day) {
    return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0));
}
function parseDateRangeFromText(text, fallbackDate) {
    if (!text)
        return null;
    const normalized = text.replace(/\u2013|\u2014/g, '-');
    const fallbackYear = fallbackDate?.getUTCFullYear?.() ?? fallbackDate?.getFullYear?.() ?? new Date().getUTCFullYear();
    const monthRegex = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b[^0-9]*([0-9]{1,2})(?:\s*-\s*([0-9]{1,2}))?(?:[^0-9]+([0-9]{4}))?/i;
    const monthMatch = normalized.match(monthRegex);
    if (monthMatch) {
        const monthName = monthMatch[1].toLowerCase();
        const monthIndex = MONTH_INDEX[monthName];
        const startDay = parseInt(monthMatch[2], 10);
        const endDay = monthMatch[3] ? parseInt(monthMatch[3], 10) : startDay;
        const year = monthMatch[4] ? parseInt(monthMatch[4], 10) : fallbackYear;
        if (!Number.isNaN(startDay) && monthIndex != null && !Number.isNaN(year)) {
            const start = buildUtcDate(year, monthIndex, startDay);
            const end = buildUtcDate(year, monthIndex, endDay);
            return { start, end };
        }
    }
    const numericRegex = /\b(\d{1,2})[\/-](\d{1,2})(?:\s*-\s*(\d{1,2}))?(?:[\/-](\d{2,4}))?/i;
    const numericMatch = normalized.match(numericRegex);
    if (numericMatch) {
        const month = parseInt(numericMatch[1], 10);
        const startDay = parseInt(numericMatch[2], 10);
        const endDay = numericMatch[3] ? parseInt(numericMatch[3], 10) : startDay;
        let year = numericMatch[4] ? parseInt(numericMatch[4], 10) : fallbackYear;
        if (year < 100)
            year += 2000;
        if (!Number.isNaN(month) && !Number.isNaN(startDay) && !Number.isNaN(year)) {
            const monthIndex = Math.min(Math.max(month - 1, 0), 11);
            const start = buildUtcDate(year, monthIndex, startDay);
            const end = buildUtcDate(year, monthIndex, endDay);
            return { start, end };
        }
    }
    return null;
}
function resolveEventDateRange({ title, html, fallbackDate }) {
    const fromTitle = parseDateRangeFromText(title, fallbackDate);
    if (fromTitle)
        return fromTitle;
    if (html) {
        const fromHtml = parseDateRangeFromText(html, fallbackDate);
        if (fromHtml)
            return fromHtml;
    }
    if (fallbackDate) {
        const day = buildUtcDate(fallbackDate.getUTCFullYear?.() ?? fallbackDate.getFullYear(), fallbackDate.getUTCMonth?.() ?? fallbackDate.getMonth(), fallbackDate.getUTCDate?.() ?? fallbackDate.getDate());
        return { start: day, end: day };
    }
    return null;
}
function buildRequestId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function buildNotifId({ uid, eventId, runGroupId, sessionStartIsoUtc, offsetMinutes }) {
    const raw = `${uid}|${eventId}|${runGroupId}|${sessionStartIsoUtc}|${offsetMinutes}`;
    return (0, crypto_1.createHash)('sha256').update(raw).digest('hex');
}
function parseTimestamp(isoUtc) {
    const date = new Date(isoUtc);
    if (Number.isNaN(date.getTime()))
        return null;
    // Timestamp from firebase-admin/firestore avoids the emulator crash seen with admin.firestore.Timestamp.
    return firestore_1.Timestamp.fromDate(date);
}
exports.clientTelemetry = (0, https_1.onRequest)({
    cors: true,
    region: SCHEDULER_REGION,
    timeoutSeconds: 15,
    memory: '128MiB',
    maxInstances: CLIENT_TELEMETRY_MAX_INSTANCES
}, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const ip = getClientIp(req);
    const ipRateLimit = rateLimitKey(clientTelemetryIpRateLimit, ip, CLIENT_TELEMETRY_IP_LIMIT, CLIENT_TELEMETRY_IP_WINDOW_MS);
    if (ipRateLimit.limited) {
        if (ipRateLimit.firstLimited) {
            logClientTelemetryRejection('rate_limited_ip', req);
        }
        res.status(204).send('');
        return;
    }
    const contentLength = Number(req.get('content-length') || 0);
    if (contentLength > CLIENT_TELEMETRY_MAX_BODY_BYTES) {
        logClientTelemetryRejection('payload_too_large', req, { contentLength });
        res.status(413).json({ error: 'Telemetry payload too large' });
        return;
    }
    let parsedBody;
    try {
        parsedBody = parseRequestBody(req.body);
    }
    catch (err) {
        logClientTelemetryRejection('invalid_json', req);
        res.status(400).json({ error: 'Invalid telemetry payload' });
        return;
    }
    const rawBodySize = Buffer.byteLength(JSON.stringify(parsedBody || {}), 'utf8');
    if (rawBodySize > CLIENT_TELEMETRY_MAX_BODY_BYTES) {
        logClientTelemetryRejection('payload_too_large', req, { rawBodySize });
        res.status(413).json({ error: 'Telemetry payload too large' });
        return;
    }
    const payload = sanitizeClientTelemetryPayload(parsedBody);
    if (!payload) {
        logClientTelemetryRejection('invalid_payload', req);
        res.status(400).json({ error: 'Invalid telemetry payload' });
        return;
    }
    const fingerprintRateLimit = rateLimitKey(clientTelemetryFingerprintRateLimit, `${ip}:${payload.fingerprint}`, CLIENT_TELEMETRY_FINGERPRINT_LIMIT, CLIENT_TELEMETRY_FINGERPRINT_WINDOW_MS);
    if (fingerprintRateLimit.limited) {
        if (fingerprintRateLimit.firstLimited) {
            logClientTelemetryRejection('rate_limited_fingerprint', req, {
                fingerprint: payload.fingerprint.slice(0, 40)
            });
        }
        res.status(204).send('');
        return;
    }
    try {
        const identifiers = await updateVisitorTelemetry(payload, firestore_1.Timestamp.now());
        logClientTelemetryEvent(payload, identifiers);
        res.status(204).send('');
    }
    catch (err) {
        logging_1.log.error('client.telemetry_failed', {
            ipHash: hashIdentifier(ip, 12),
            sourceEvent: payload.event
        }, err);
        res.status(500).json({ error: 'Unable to store telemetry' });
    }
});
exports.systemHealth = (0, https_1.onRequest)({
    cors: true,
    region: SCHEDULER_REGION,
    timeoutSeconds: 15,
    memory: '128MiB',
    maxInstances: 2,
    invoker: 'private',
    secrets: ['SHEETS_API_KEY']
}, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).send('Method not allowed');
        return;
    }
    const checkedAt = new Date().toISOString();
    const requestHost = getRequestHost(req);
    const checks = {
        firebaseAdmin: {
            status: admin.apps.length > 0 ? 'ok' : 'error'
        },
        firestore: {
            status: 'ok'
        },
        auth: {
            status: 'ok'
        },
        sheetsConfig: {
            status: SHEETS_API_KEY ? 'ok' : 'degraded',
            detail: SHEETS_API_KEY ? undefined : 'SHEETS_API_KEY is not configured for this function.'
        },
        sheetsProbe: {
            status: 'ok'
        }
    };
    try {
        await usersCollection.limit(1).get();
    }
    catch (err) {
        checks.firestore = {
            status: 'error',
            detail: err?.message || 'Firestore read failed'
        };
    }
    const [authCheck, sheetsProbeCheck] = await Promise.all([
        runSystemAuthHealthProbe(requestHost),
        runSystemSheetsHealthProbe().catch((err) => ({
            status: 'error',
            detail: err?.message || 'Sheet health probe failed'
        }))
    ]);
    checks.auth = authCheck;
    checks.sheetsProbe = sheetsProbeCheck;
    const statuses = Object.values(checks).map(check => check.status);
    const status = statuses.includes('error')
        ? 'error'
        : statuses.includes('degraded')
            ? 'degraded'
            : 'ok';
    const payload = { status, checkedAt, checks };
    if (checks.auth.status !== 'ok') {
        logging_1.log.warn('system.auth_health_failed', {
            checkedAt,
            host: requestHost || undefined,
            auth: checks.auth
        });
    }
    if (status === 'ok') {
        logging_1.log.info('system.health_ok', payload);
    }
    else {
        logging_1.log.warn('system.health_failed', payload);
    }
    res.status(status === 'error' ? 503 : 200).json(payload);
});
async function collectSystemSheetsHealthProbeIds() {
    const candidates = [];
    const pushCandidate = (value) => {
        const id = typeof value === 'string' ? value.trim() : '';
        if (!id || candidates.includes(id))
            return;
        candidates.push(id);
    };
    if (TEST_MODE) {
        pushCandidate('TEST_SHEET_ID');
        return candidates;
    }
    const targetCount = SHEETS_HEALTH_PROBE_MAX_CANDIDATES;
    try {
        const metadataSnap = await sheetMetadataCollection
            .orderBy('lastMetadataFetchAt', 'desc')
            .limit(targetCount)
            .get();
        metadataSnap.forEach(doc => {
            const data = doc.data();
            pushCandidate(data?.spreadsheetId || doc.id);
        });
    }
    catch (err) {
        logging_1.log.debug('system.health_probe_metadata_candidates_failed', undefined, err);
    }
    if (candidates.length >= targetCount) {
        return candidates.slice(0, targetCount);
    }
    try {
        const sourceSnap = await sheetSourcesCollection
            .orderBy('lastValuesFetchAt', 'desc')
            .limit(targetCount)
            .get();
        sourceSnap.forEach(doc => {
            const data = doc.data();
            pushCandidate(data?.spreadsheetId);
        });
    }
    catch (err) {
        logging_1.log.debug('system.health_probe_source_candidates_failed', undefined, err);
    }
    if (candidates.length >= targetCount) {
        return candidates.slice(0, targetCount);
    }
    try {
        const eventSnap = await eventCacheCollection
            .orderBy('updatedAt', 'desc')
            .limit(targetCount)
            .get();
        eventSnap.forEach(doc => {
            const data = doc.data();
            pushCandidate(extractSpreadsheetId(data?.sheetUrl || ''));
        });
    }
    catch (err) {
        logging_1.log.debug('system.health_probe_event_candidates_failed', undefined, err);
    }
    return candidates.slice(0, targetCount);
}
async function runSystemSheetsHealthProbe() {
    const candidates = await collectSystemSheetsHealthProbeIds();
    if (!candidates.length) {
        return {
            status: 'ok',
            detail: 'No known spreadsheet probe target is available yet.'
        };
    }
    let lastError = 'Unknown Sheets probe error';
    for (const spreadsheetId of candidates) {
        try {
            const metadata = await getSheetMetadata(spreadsheetId, { forceRefresh: true });
            return {
                status: 'ok',
                detail: `Fetched ${metadata.tabs.length} tab(s) from spreadsheet ${spreadsheetId}.`
            };
        }
        catch (err) {
            lastError = err?.message || lastError;
            logging_1.log.debug('system.health_probe_candidate_failed', { spreadsheetId }, err);
        }
    }
    return {
        status: 'error',
        detail: `Sheets probe failed for ${candidates.length} candidate(s): ${lastError}`
    };
}
function normalizeHost(value) {
    if (typeof value !== 'string')
        return '';
    const host = value.split(',')[0]?.trim().toLowerCase() || '';
    if (!host)
        return '';
    return host.replace(/:\d+$/, '');
}
function getRequestHost(req) {
    return normalizeHost(req.get('x-forwarded-host') || req.get('host') || '');
}
function shouldValidateAuthorizedDomain(host) {
    if (!host || host === 'localhost' || host === '127.0.0.1')
        return false;
    if (host.endsWith('.cloudfunctions.net') || host.endsWith('.run.app'))
        return false;
    return true;
}
async function fetchIdentityToolkitAdminResource(accessToken, resourcePath) {
    const response = await fetch(`${IDENTITY_TOOLKIT_ADMIN_BASE}/${resourcePath}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Identity Toolkit request failed (${response.status}): ${text}`);
    }
    return response.json();
}
async function runSystemAuthHealthProbe(expectedHost) {
    if (TEST_MODE || process.env.FUNCTIONS_EMULATOR === 'true') {
        return {
            status: 'ok',
            detail: 'Auth probe skipped in test/emulator mode.'
        };
    }
    const projectId = getRuntimeProjectId();
    if (!projectId) {
        return {
            status: 'error',
            detail: 'Unable to resolve runtime project id for Firebase Auth probe.'
        };
    }
    try {
        await admin.auth().listUsers(1);
    }
    catch (err) {
        return {
            status: 'error',
            detail: `Firebase Auth Admin probe failed: ${err?.message || 'listUsers failed'}`
        };
    }
    try {
        const accessToken = await getMetadataAccessToken();
        const [projectConfig, googleProviderConfig] = await Promise.all([
            fetchIdentityToolkitAdminResource(accessToken, `projects/${projectId}/config`),
            fetchIdentityToolkitAdminResource(accessToken, `projects/${projectId}/defaultSupportedIdpConfigs/google.com`)
        ]);
        const issues = [];
        const warnings = [];
        if (googleProviderConfig?.enabled !== true) {
            issues.push('Google sign-in is disabled.');
        }
        if (projectConfig?.signIn?.email?.enabled !== true) {
            warnings.push('Email/password sign-in is disabled.');
        }
        const normalizedExpectedHost = normalizeHost(expectedHost || '');
        const authorizedDomains = Array.isArray(projectConfig.authorizedDomains)
            ? projectConfig.authorizedDomains.map(domain => normalizeHost(domain)).filter(Boolean)
            : [];
        if (normalizedExpectedHost && shouldValidateAuthorizedDomain(normalizedExpectedHost) && !authorizedDomains.includes(normalizedExpectedHost)) {
            issues.push(`Authorized domains are missing ${normalizedExpectedHost}.`);
        }
        const confirmations = [
            'Firebase Auth Admin API reachable.',
            googleProviderConfig?.enabled === true ? 'Google sign-in enabled.' : '',
            projectConfig?.signIn?.email?.enabled === true ? 'Email/password sign-in enabled.' : '',
            normalizedExpectedHost && shouldValidateAuthorizedDomain(normalizedExpectedHost) && authorizedDomains.includes(normalizedExpectedHost)
                ? `Authorized domains include ${normalizedExpectedHost}.`
                : ''
        ].filter(Boolean);
        if (issues.length) {
            return {
                status: 'error',
                detail: [...issues, ...warnings, ...confirmations].join(' ')
            };
        }
        if (warnings.length) {
            return {
                status: 'degraded',
                detail: [...warnings, ...confirmations].join(' ')
            };
        }
        return {
            status: 'ok',
            detail: confirmations.join(' ')
        };
    }
    catch (err) {
        return {
            status: 'error',
            detail: `Firebase Auth config probe failed: ${err?.message || 'config fetch failed'}`
        };
    }
}
function computeNotificationExpiry(fireAt) {
    if (!fireAt)
        return null;
    return firestore_1.Timestamp.fromMillis(fireAt.toMillis() + NOTIFICATION_TTL_MS);
}
function deriveScheduledNotificationStatus(data, now) {
    const explicitStatus = typeof data?.status === 'string' ? data.status.trim() : '';
    if (explicitStatus)
        return explicitStatus;
    if (data?.sentAt?.toMillis?.())
        return 'sent';
    if (data?.undeliverableAt?.toMillis?.() || data?.undeliverableReason)
        return 'undeliverable';
    if (data?.leaseUntil?.toMillis?.() && data.leaseUntil.toMillis() > now.toMillis())
        return 'sending';
    return 'pending';
}
function isTransientMessagingError(code) {
    return code === 'messaging/internal-error' || code === 'messaging/server-unavailable';
}
function isInvalidTokenError(code) {
    return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}
function buildMessage({ tokenList, title, body, data, tag }) {
    const sanitized = sanitizeData(data);
    if (tag)
        sanitized.tag = tag;
    return {
        tokens: tokenList,
        notification: { title, body },
        data: sanitized,
        android: {
            priority: 'high'
        },
        apns: {
            payload: {
                aps: {
                    sound: 'default'
                }
            }
        },
        webpush: {
            headers: {
                Urgency: 'high',
                TTL: '900'
            },
            notification: {
                icon: `${appPublicUrl}/livegrid-icon.png`,
                badge: `${appPublicUrl}/livegrid-icon-maskable.png`,
                vibrate: [120, 50, 120],
                tag: tag || undefined,
                requireInteraction: false
            },
            fcmOptions: {
                link: appPublicUrl
            }
        }
    };
}
function buildEventId(source, seed) {
    return `${source}-${(0, crypto_1.createHash)('sha256').update(seed).digest('hex').slice(0, 24)}`;
}
function normalizeNasaEvents(rssXml) {
    const items = Array.from(rssXml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)).map(match => match[1]);
    const now = Date.now();
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const events = [];
    items.forEach((itemXml, index) => {
        const titleRaw = extractXmlTag(itemXml, 'title') || `Event ${index + 1}`;
        const title = decodeHtmlEntities(titleRaw).trim();
        const pubDateStr = extractXmlTag(itemXml, 'pubDate') || extractXmlTag(itemXml, 'dc:date');
        const pubDate = pubDateStr ? new Date(pubDateStr) : null;
        if (!pubDate || Number.isNaN(pubDate.getTime()))
            return;
        if (now - pubDate.getTime() > sixtyDaysMs)
            return;
        const content = extractXmlTag(itemXml, 'content:encoded')
            || extractXmlTag(itemXml, 'description')
            || '';
        const sheetUrl = extractPreferredSheetUrlFromHtml(content);
        if (!sheetUrl)
            return;
        const eventUrl = extractXmlTag(itemXml, 'link');
        const guid = extractXmlTag(itemXml, 'guid') || eventUrl || title;
        const eventId = buildEventId('nasa', guid);
        const range = resolveEventDateRange({ title, html: content, fallbackDate: pubDate });
        if (!range)
            return;
        events.push({
            source: 'nasa',
            eventId,
            title,
            sheetUrl,
            eventUrl: eventUrl || null,
            startDate: range.start,
            endDate: range.end,
            sourceUpdatedAt: pubDate
        });
    });
    return events;
}
function normalizeHodEvents(events) {
    const normalized = [];
    events.forEach((event, index) => {
        const { eventUrl, title, sheetUrl, html } = event;
        const idMatch = eventUrl.match(/-(\d{5,})(?:\/)?$/);
        const eventIdSeed = idMatch && idMatch[1] ? `hod-${idMatch[1]}` : `${eventUrl}-${index}`;
        const eventId = buildEventId('hod', eventIdSeed);
        const range = resolveEventDateRange({ title, html });
        const fallback = new Date();
        const startDate = range?.start || fallback;
        const endDate = range?.end || startDate;
        normalized.push({
            source: 'hod',
            eventId,
            title,
            sheetUrl,
            eventUrl,
            startDate,
            endDate,
            sourceUpdatedAt: null
        });
    });
    return normalized;
}
async function refreshEventCacheForSource(source, events) {
    const now = firestore_1.Timestamp.now();
    const batch = db.batch();
    const seen = new Set();
    events.forEach(event => {
        const docId = `${event.source}:${event.eventId}`;
        seen.add(docId);
        const docRef = eventCacheCollection.doc(docId);
        const payloadHash = (0, crypto_1.createHash)('sha256').update(JSON.stringify({
            title: event.title,
            sheetUrl: event.sheetUrl,
            eventUrl: event.eventUrl,
            startDate: event.startDate.toISOString(),
            endDate: event.endDate.toISOString()
        })).digest('hex');
        batch.set(docRef, {
            source: event.source,
            eventId: event.eventId,
            title: event.title,
            sheetUrl: event.sheetUrl,
            eventUrl: event.eventUrl,
            label: event.source === 'nasa' ? `[NASA-SE] ${event.title}` : `[HOD-MA] ${event.title}`,
            startDate: firestore_1.Timestamp.fromDate(event.startDate),
            endDate: firestore_1.Timestamp.fromDate(event.endDate),
            sourceUpdatedAt: event.sourceUpdatedAt ? firestore_1.Timestamp.fromDate(event.sourceUpdatedAt) : null,
            updatedAt: now,
            lastSeenAt: now,
            contentHash: payloadHash,
            isActive: true
        }, { merge: true });
    });
    if (events.length) {
        await batch.commit();
    }
    const staleCutoff = firestore_1.Timestamp.fromMillis(now.toMillis() - EVENT_CACHE_STALE_DAYS * 24 * 60 * 60 * 1000);
    const staleSnap = await eventCacheCollection
        .where('source', '==', source)
        .where('lastSeenAt', '<', staleCutoff)
        .where('isActive', '==', true)
        .get();
    if (!staleSnap.empty) {
        const staleBatch = db.batch();
        staleSnap.docs.forEach(doc => {
            staleBatch.set(doc.ref, { isActive: false, updatedAt: now }, { merge: true });
        });
        await staleBatch.commit();
    }
}
async function fetchHodEventDetails() {
    const fixtureOrg = readFixtureText('hod-org.html');
    const fixtureEvent = readFixtureText('hod-event.html');
    if (fixtureOrg && fixtureEvent) {
        const eventLinks = extractEventLinksFromOrg(fixtureOrg).slice(0, HOD_MA_EVENT_LIMIT);
        const events = [];
        for (const eventUrl of eventLinks) {
            const sheetUrl = extractSheetUrlFromHtml(fixtureEvent);
            if (!sheetUrl)
                continue;
            const title = extractEventTitle(fixtureEvent, eventUrl);
            events.push({ eventUrl, title, sheetUrl, html: fixtureEvent });
        }
        return events;
    }
    const upstream = await fetch(HOD_MA_ORG_URL, {
        headers: { 'User-Agent': HOD_MA_USER_AGENT }
    });
    if (!upstream.ok) {
        throw new Error(`HOD org fetch failed (${upstream.status})`);
    }
    const body = await upstream.text();
    const eventLinks = extractEventLinksFromOrg(body).slice(0, HOD_MA_EVENT_LIMIT);
    const events = [];
    for (const eventUrl of eventLinks) {
        try {
            const eventResp = await fetch(eventUrl, {
                headers: { 'User-Agent': HOD_MA_USER_AGENT }
            });
            if (!eventResp.ok)
                continue;
            const eventHtml = await eventResp.text();
            const sheetUrl = extractSheetUrlFromHtml(eventHtml);
            if (!sheetUrl)
                continue;
            const title = extractEventTitle(eventHtml, eventUrl);
            events.push({ eventUrl, title, sheetUrl, html: eventHtml });
        }
        catch (err) {
            logging_1.log.warn('hod_ma.event_inspect_failed', { eventUrl }, err);
        }
    }
    return events;
}
// Simple proxy for the NASA-SE RSS feed so the frontend can avoid CORS issues.
exports.nasaFeed = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).send('Method not allowed');
        return;
    }
    try {
        const fixture = readFixtureText('nasa-feed.xml');
        if (fixture) {
            res.set('Content-Type', 'application/rss+xml; charset=utf-8');
            res.status(200).send(fixture);
            return;
        }
        const upstream = await fetch('https://nasa-se.com/feed/');
        if (!upstream.ok) {
            logging_1.log.error('nasa_feed.upstream_error', { status: upstream.status, statusText: upstream.statusText });
            res.status(502).send('Failed to fetch upstream feed');
            return;
        }
        const body = await upstream.text();
        const contentType = upstream.headers.get('content-type') || 'application/rss+xml; charset=utf-8';
        res.set('Content-Type', contentType);
        res.status(200).send(body);
    }
    catch (err) {
        logging_1.log.error('nasa_feed.proxy_failed', undefined, err);
        res.status(500).send('Error fetching feed');
    }
});
exports.hodMaEvents = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).send('Method not allowed');
        return;
    }
    try {
        const fixtureOrg = readFixtureText('hod-org.html');
        const fixtureEvent = readFixtureText('hod-event.html');
        if (fixtureOrg && fixtureEvent) {
            const eventLinks = extractEventLinksFromOrg(fixtureOrg).slice(0, HOD_MA_EVENT_LIMIT);
            const events = [];
            for (const eventUrl of eventLinks) {
                const sheetUrl = extractSheetUrlFromHtml(fixtureEvent);
                if (!sheetUrl)
                    continue;
                const title = extractEventTitle(fixtureEvent, eventUrl);
                const idMatch = eventUrl.match(/-(\d{5,})(?:\/)?$/);
                const eventId = idMatch && idMatch[1]
                    ? `hod-${idMatch[1]}`
                    : `hod-${events.length + 1}`;
                events.push({ eventId, title, sheetUrl, eventUrl });
            }
            res.status(200).json({ events });
            return;
        }
        const upstream = await fetch(HOD_MA_ORG_URL, {
            headers: {
                'User-Agent': HOD_MA_USER_AGENT
            }
        });
        if (!upstream.ok) {
            logging_1.log.error('hod_ma.upstream_org_error', { status: upstream.status, statusText: upstream.statusText });
            res.status(502).json({ error: 'Failed to fetch upstream events' });
            return;
        }
        const body = await upstream.text();
        const eventLinks = extractEventLinksFromOrg(body).slice(0, HOD_MA_EVENT_LIMIT);
        const events = [];
        for (const eventUrl of eventLinks) {
            try {
                const eventResp = await fetch(eventUrl, {
                    headers: { 'User-Agent': HOD_MA_USER_AGENT }
                });
                if (!eventResp.ok)
                    continue;
                const eventHtml = await eventResp.text();
                const sheetUrl = extractSheetUrlFromHtml(eventHtml);
                if (!sheetUrl)
                    continue;
                const title = extractEventTitle(eventHtml, eventUrl);
                const idMatch = eventUrl.match(/-(\d{5,})(?:\/)?$/);
                const eventId = idMatch && idMatch[1]
                    ? `hod-${idMatch[1]}`
                    : `hod-${events.length + 1}`;
                events.push({
                    id: eventId,
                    title,
                    sheetUrl,
                    eventUrl
                });
            }
            catch (err) {
                logging_1.log.warn('hod_ma.event_inspect_failed', { eventUrl }, err);
            }
        }
        res.status(200).json({ events });
    }
    catch (err) {
        logging_1.log.error('hod_ma.fetch_failed', undefined, err);
        res.status(500).json({ error: 'Error fetching events' });
    }
});
exports.refreshEventCache = (0, scheduler_1.onSchedule)({ schedule: 'every 60 minutes', timeZone: 'UTC', region: SCHEDULER_REGION }, async () => {
    try {
        const nasaFixture = readFixtureText('nasa-feed.xml');
        let rssXml = '';
        if (nasaFixture) {
            rssXml = nasaFixture;
        }
        else {
            const nasaResp = await fetch('https://nasa-se.com/feed/');
            if (!nasaResp.ok) {
                logging_1.log.warn('event_cache.nasa_feed_error', { status: nasaResp.status, statusText: nasaResp.statusText });
            }
            rssXml = nasaResp.ok ? await nasaResp.text() : '';
        }
        const nasaEvents = rssXml ? normalizeNasaEvents(rssXml) : [];
        const hodRaw = await fetchHodEventDetails();
        const hodEvents = normalizeHodEvents(hodRaw);
        await Promise.all([
            refreshEventCacheForSource('nasa', nasaEvents),
            refreshEventCacheForSource('hod', hodEvents)
        ]);
        logging_1.log.info('event_cache.refresh_complete', {
            nasa: nasaEvents.length,
            hod: hodEvents.length
        });
    }
    catch (err) {
        logging_1.log.error('event_cache.refresh_failed', undefined, err);
    }
});
exports.cachedEvents = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'GET') {
        res.status(405).send('Method not allowed');
        return;
    }
    try {
        const sourceParam = (req.query?.source || '').toString().trim();
        let query = eventCacheCollection;
        if (sourceParam === 'nasa' || sourceParam === 'hod') {
            query = query.where('source', '==', sourceParam);
        }
        query = query.orderBy('startDate').limit(EVENT_CACHE_MAX);
        const snapshot = await query.get();
        const events = snapshot.docs
            .filter(doc => doc.data()?.isActive !== false)
            .map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                source: data.source,
                eventId: data.eventId,
                title: data.title,
                sheetUrl: data.sheetUrl,
                eventUrl: data.eventUrl || null,
                label: data.label,
                startDate: data.startDate?.toDate?.().toISOString?.() || null,
                endDate: data.endDate?.toDate?.().toISOString?.() || null,
                updatedAt: data.updatedAt?.toDate?.().toISOString?.() || null
            };
        });
        res.status(200).json({
            events,
            count: events.length,
            fetchedAt: new Date().toISOString()
        });
    }
    catch (err) {
        logging_1.log.error('event_cache.read_failed', undefined, err);
        res.status(500).json({ error: 'Failed to read cached events' });
    }
});
exports.testSeedEventCache = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (!assertTestMode(res))
        return;
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const body = req.body || {};
    const source = body.source === 'hod' ? 'hod' : 'nasa';
    const eventId = body.eventId || `event-${Date.now()}`;
    const docId = `${source}:${eventId}`;
    const startDate = body.startDateIso ? new Date(body.startDateIso) : new Date();
    const endDate = body.endDateIso ? new Date(body.endDateIso) : startDate;
    await eventCacheCollection.doc(docId).set({
        source,
        eventId,
        title: body.title || 'Test Event',
        sheetUrl: body.sheetUrl || 'https://docs.google.com/spreadsheets/d/TEST_SHEET_ID/edit',
        eventUrl: body.eventUrl || null,
        label: body.label || `[${source.toUpperCase()}] Test Event`,
        startDate: firestore_1.Timestamp.fromDate(startDate),
        endDate: firestore_1.Timestamp.fromDate(endDate),
        updatedAt: firestore_1.Timestamp.now(),
        lastSeenAt: firestore_1.Timestamp.now(),
        isActive: true
    });
    res.json({ status: 'ok', id: docId });
});
exports.registerPushToken = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const { token, platform = 'unknown', timezone = null, appVersion = null, clientInfo = null } = req.body || {};
    if (!token) {
        res.status(400).json({ error: 'token is required' });
        return;
    }
    const uid = await authenticate(req);
    const tokenHash = tokenFingerprint(token);
    const clientSummary = clientInfo ? {
        os: clientInfo.os || null,
        browser: clientInfo.browser || null,
        deviceClass: clientInfo.deviceClass || null,
        isStandalone: clientInfo.isStandalone ?? null,
        displayMode: clientInfo.displayMode || null
    } : null;
    logging_1.log.info('push_token.register_request', {
        uid: uid || null,
        tokenHash,
        platform,
        timezone,
        appVersion,
        client: clientSummary
    });
    try {
        await db.collection('notificationTokens').doc(token).set({
            uid: uid || null,
            platform,
            clientInfo: clientInfo || null,
            timezone,
            appVersion,
            lastSeenAt: firestore_1.FieldValue.serverTimestamp()
        }, { merge: true });
        if (uid) {
            await usersCollection.doc(uid).set({
                tokens: firestore_1.FieldValue.arrayUnion(token),
                updatedAt: firestore_1.FieldValue.serverTimestamp()
            }, { merge: true });
            logging_1.log.info('push_token.linked_to_user', { uid, tokenHash });
        }
        else {
            logging_1.log.warn('push_token.missing_auth_uid', { tokenHash });
        }
        logging_1.log.info('push_token.stored', { uid: uid || null, tokenHash });
        res.json({ status: 'registered' });
    }
    catch (err) {
        logging_1.log.error('push_token.store_failed', { tokenHash }, err);
        res.status(500).json({ error: 'Failed to store token' });
    }
});
exports.unregisterPushToken = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const { token } = req.body || {};
    if (!token) {
        res.status(400).json({ error: 'token is required' });
        return;
    }
    const uid = await authenticate(req);
    const tokenHash = tokenFingerprint(token);
    logging_1.log.info('push_token.unregister_request', { uid: uid || null, tokenHash });
    try {
        await db.collection('notificationTokens').doc(token).delete();
        if (uid) {
            await usersCollection.doc(uid).set({
                tokens: firestore_1.FieldValue.arrayRemove(token),
                updatedAt: firestore_1.FieldValue.serverTimestamp()
            }, { merge: true });
        }
        logging_1.log.info('push_token.deleted', { uid: uid || null, tokenHash });
        res.json({ status: 'deleted' });
    }
    catch (err) {
        logging_1.log.error('push_token.delete_failed', { tokenHash }, err);
        res.status(500).json({ error: 'Failed to delete token' });
    }
});
exports.sendPushNotification = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    const uid = await authenticate(req);
    const { token, title, body, data = {}, tag = undefined } = req.body || {};
    if (!token || !title || !body) {
        res.status(400).json({ error: 'token, title, and body are required' });
        return;
    }
    const message = buildMessage({
        tokenList: [token],
        title,
        body,
        data,
        tag
    });
    try {
        const response = await messaging.sendEachForMulticast(message);
        logging_1.log.info('push.send_response', {
            requestedBy: uid || null,
            successCount: response?.successCount ?? null,
            failureCount: response?.failureCount ?? null,
            messageId: response?.responses?.[0]?.messageId || null
        });
        res.json({ status: 'sent', id: response?.responses?.[0]?.messageId || null, requestedBy: uid || null });
    }
    catch (err) {
        logging_1.log.error('push.send_failed', { requestedBy: uid || null }, err);
        res.status(500).json({ error: 'Failed to send push message', details: err?.message || err });
    }
});
exports.syncScheduledNotifications = (0, https_1.onCall)({ region: SCHEDULER_REGION }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication required');
    }
    const uid = request.auth.uid;
    const { eventId, desiredNotifications } = request.data || {};
    logging_1.log.info('notifications.sync_request', {
        uid,
        eventId,
        count: Array.isArray(desiredNotifications) ? desiredNotifications.length : 0
    });
    if (!eventId || typeof eventId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'eventId is required');
    }
    if (!Array.isArray(desiredNotifications)) {
        throw new https_1.HttpsError('invalid-argument', 'desiredNotifications must be an array');
    }
    const now = firestore_1.FieldValue.serverTimestamp();
    const normalizedNow = firestore_1.Timestamp.now();
    const desiredMap = new Map();
    const notifIds = [];
    const fireAtTimes = [];
    for (const item of desiredNotifications) {
        if (!item?.runGroupId || !item?.sessionStartIsoUtc || !item?.fireAtIsoUtc || typeof item?.offsetMinutes !== 'number') {
            throw new https_1.HttpsError('invalid-argument', 'Each notification requires runGroupId, sessionStartIsoUtc, offsetMinutes, fireAtIsoUtc');
        }
        if (!item?.payload?.title || !item?.payload?.body) {
            throw new https_1.HttpsError('invalid-argument', 'Each notification requires payload.title and payload.body');
        }
        const notifId = buildNotifId({
            uid,
            eventId,
            runGroupId: item.runGroupId,
            sessionStartIsoUtc: item.sessionStartIsoUtc,
            offsetMinutes: item.offsetMinutes
        });
        desiredMap.set(notifId, item);
        notifIds.push(notifId);
        if (item?.fireAtIsoUtc)
            fireAtTimes.push(item.fireAtIsoUtc);
    }
    const docRefs = notifIds.map(id => scheduledCollection.doc(id));
    const existingDocs = docRefs.length ? await db.getAll(...docRefs) : [];
    const existingById = new Map(existingDocs.map(doc => [doc.id, doc]));
    const batch = db.batch();
    desiredMap.forEach((item, notifId) => {
        const existing = existingById.get(notifId);
        const existingData = existing?.data();
        const existingStatus = deriveScheduledNotificationStatus(existingData, normalizedNow);
        const fireAt = parseTimestamp(item.fireAtIsoUtc);
        if (!fireAt) {
            throw new https_1.HttpsError('invalid-argument', `Invalid fireAtIsoUtc for ${notifId}`);
        }
        const docRef = scheduledCollection.doc(notifId);
        if (existing?.exists && existingStatus === 'sent') {
            const existingExpiresAt = existing?.data()?.expiresAt;
            if (existingExpiresAt) {
                return;
            }
            batch.set(docRef, { expiresAt: computeNotificationExpiry(fireAt), updatedAt: now }, { merge: true });
            return;
        }
        const payload = {
            title: item.payload.title,
            body: item.payload.body,
            data: item.payload.data || {}
        };
        const base = {
            uid,
            eventId,
            runGroupId: item.runGroupId,
            fireAt,
            expiresAt: computeNotificationExpiry(fireAt),
            dedupeKey: notifId,
            payload,
            updatedAt: now
        };
        if (!existing?.exists) {
            batch.set(docRef, {
                ...base,
                status: 'pending',
                leaseUntil: null,
                createdAt: now,
                sentAt: null
            }, { merge: true });
        }
        else {
            const repair = typeof existingData?.status === 'string' && existingData.status.trim()
                ? {}
                : {
                    status: existingStatus,
                    leaseUntil: existingStatus === 'sending' ? existingData?.leaseUntil ?? null : null
                };
            const reset = existingStatus === 'undeliverable'
                ? {
                    status: 'pending',
                    leaseUntil: null,
                    sentAt: null,
                    undeliverableAt: null,
                    undeliverableReason: null
                }
                : {};
            batch.set(docRef, { ...base, ...repair, ...reset }, { merge: true });
        }
    });
    const pendingSnap = await scheduledCollection
        .where('uid', '==', uid)
        .where('eventId', '==', eventId)
        .where('status', '==', 'pending')
        .get();
    pendingSnap.forEach(doc => {
        if (!desiredMap.has(doc.id)) {
            batch.delete(doc.ref);
        }
    });
    await batch.commit();
    const sortedFireAt = fireAtTimes.filter(Boolean).sort();
    logging_1.log.info('notifications.sync_complete', {
        uid,
        eventId,
        count: desiredMap.size,
        earliestFireAt: sortedFireAt[0] || null,
        latestFireAt: sortedFireAt[sortedFireAt.length - 1] || null
    });
    return { status: 'ok', count: desiredMap.size };
});
async function leaseNotification(docRef, now) {
    let leased = false;
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists)
            return;
        const data = snap.data();
        const status = data.status ?? 'pending';
        if (status !== 'pending' && status !== 'sending')
            return;
        if (data.leaseUntil && data.leaseUntil.toMillis() > now.toMillis())
            return;
        tx.update(docRef, {
            status: 'sending',
            leaseUntil: firestore_1.Timestamp.fromMillis(now.toMillis() + LEASE_MS),
            updatedAt: now
        });
        leased = true;
    });
    return leased;
}
function normalizeTimestamp(value) {
    if (!value)
        return firestore_1.Timestamp.now();
    if (value instanceof firestore_1.Timestamp)
        return value;
    if (typeof value?.toMillis === 'function')
        return firestore_1.Timestamp.fromMillis(value.toMillis());
    if (value instanceof Date)
        return firestore_1.Timestamp.fromDate(value);
    return firestore_1.Timestamp.now();
}
async function dispatchScheduledNotifications(now) {
    const normalizedNow = normalizeTimestamp(now);
    const dispatchLimit = DISPATCH_LIMIT * 4;
    const pendingSnap = await scheduledCollection
        .where('status', '==', 'pending')
        .where('fireAt', '<=', normalizedNow)
        .orderBy('fireAt')
        .limit(dispatchLimit)
        .get();
    const sendingSnap = await scheduledCollection
        .where('status', '==', 'sending')
        .where('fireAt', '<=', normalizedNow)
        .orderBy('fireAt')
        .limit(DISPATCH_LIMIT)
        .get();
    const docsById = new Map();
    pendingSnap.docs.forEach(doc => docsById.set(doc.id, doc));
    sendingSnap.docs.forEach(doc => docsById.set(doc.id, doc));
    const docs = Array.from(docsById.values()).sort((a, b) => {
        const aFireAt = a.data()?.fireAt?.toMillis?.() ?? 0;
        const bFireAt = b.data()?.fireAt?.toMillis?.() ?? 0;
        return aFireAt - bFireAt;
    });
    if (!docs.length) {
        try {
            const nextSnap = await scheduledCollection
                .where('status', '==', 'pending')
                .orderBy('fireAt')
                .limit(1)
                .get();
            if (nextSnap.empty) {
                logging_1.log.debug('scheduler.no_notifications_scheduled', { now: normalizedNow.toDate().toISOString() });
            }
            else {
                const nextDoc = nextSnap.docs[0];
                const nextData = nextDoc.data();
                const nextFireAt = nextData.fireAt?.toDate?.().toISOString?.() || null;
                logging_1.log.debug('scheduler.no_notifications_due', {
                    now: normalizedNow.toDate().toISOString(),
                    nextFireAt,
                    nextStatus: nextData.status || null,
                    nextDocId: nextDoc.id
                });
            }
        }
        catch (err) {
            logging_1.log.warn('scheduler.next_check_failed', undefined, err);
        }
        return;
    }
    logging_1.log.info('scheduler.fetched', { count: docs.length, now: normalizedNow.toDate().toISOString() });
    for (const doc of docs) {
        const data = doc.data();
        const status = data.status ?? 'pending';
        if (status !== 'pending' && status !== 'sending') {
            logging_1.log.debug('scheduler.skip_non_pending', { docId: doc.id, status });
            continue;
        }
        if (status === 'sending' && data.leaseUntil && data.leaseUntil.toMillis() > normalizedNow.toMillis()) {
            logging_1.log.debug('scheduler.skip_lease', { docId: doc.id });
            continue;
        }
        const leased = await leaseNotification(doc.ref, normalizedNow);
        if (!leased) {
            logging_1.log.debug('scheduler.skip_lease', { docId: doc.id });
            continue;
        }
        const uid = data.uid;
        const payload = data.payload || {};
        const title = payload.title || 'LiveGrid';
        const body = payload.body || '';
        const dataPayload = payload.data || {};
        const tag = dataPayload.tag || data.dedupeKey;
        try {
            const userDoc = await usersCollection.doc(uid).get();
            const tokens = userDoc.exists && Array.isArray(userDoc.data()?.tokens) ? userDoc.data().tokens : [];
            if (!userDoc.exists) {
                logging_1.log.warn('scheduler.missing_user_doc', { uid, docId: doc.id });
            }
            if (!tokens.length) {
                const reason = userDoc.exists ? 'no_tokens' : 'missing_user_doc';
                logging_1.log.error('scheduler.undeliverable', {
                    uid,
                    docId: doc.id,
                    reason,
                    userDocExists: userDoc.exists,
                    tokensCount: tokens.length
                });
                await doc.ref.update({
                    status: 'undeliverable',
                    undeliverableReason: reason,
                    undeliverableAt: normalizedNow,
                    leaseUntil: null,
                    updatedAt: normalizedNow
                });
                continue;
            }
            const tokenDocs = tokens.length
                ? await db.getAll(...tokens.map(tokenValue => db.collection('notificationTokens').doc(tokenValue)))
                : [];
            const tokenMeta = tokenDocs.map((snap, idx) => {
                const tokenValue = tokens[idx];
                const hash = tokenFingerprint(tokenValue);
                if (!snap.exists) {
                    return { tokenHash: hash, missingTokenDoc: true };
                }
                const data = snap.data();
                const client = data?.clientInfo || {};
                const lastSeenAt = data?.lastSeenAt?.toDate?.()?.toISOString?.() || null;
                return {
                    tokenHash: hash,
                    platform: data?.platform || null,
                    appVersion: data?.appVersion || null,
                    timezone: data?.timezone || null,
                    os: client?.os || null,
                    browser: client?.browser || null,
                    deviceClass: client?.deviceClass || null,
                    isStandalone: client?.isStandalone ?? null,
                    displayMode: client?.displayMode || null,
                    lastSeenAt,
                    tokenUid: data?.uid || null,
                    missingTokenDoc: false
                };
            });
            if (tokenMeta.length) {
                logging_1.log.debug('scheduler.token_metadata', {
                    docId: doc.id,
                    uid,
                    tokens: tokenMeta
                });
            }
            const tokenMetaByHash = new Map(tokenMeta.map(entry => [entry.tokenHash, entry]));
            const message = buildMessage({
                tokenList: tokens,
                title,
                body,
                data: dataPayload,
                tag
            });
            const response = await messaging.sendEachForMulticast(message);
            const invalidTokens = [];
            let transientFailures = 0;
            const failureDetails = [];
            response.responses.forEach((resp, idx) => {
                if (resp.success)
                    return;
                const code = resp.error?.code;
                const tokenHash = tokenFingerprint(tokens[idx]);
                const meta = tokenHash ? tokenMetaByHash.get(tokenHash) : null;
                failureDetails.push({
                    tokenHash,
                    code,
                    message: resp.error?.message,
                    platform: meta?.platform ?? null,
                    deviceClass: meta?.deviceClass ?? null,
                    os: meta?.os ?? null,
                    browser: meta?.browser ?? null,
                    isStandalone: meta?.isStandalone ?? null
                });
                if (isInvalidTokenError(code)) {
                    invalidTokens.push(tokens[idx]);
                }
                else if (isTransientMessagingError(code)) {
                    transientFailures += 1;
                }
            });
            logging_1.log.info('scheduler.dispatch_result', {
                docId: doc.id,
                uid,
                tokenCount: tokens.length,
                successCount: response.successCount,
                failureCount: response.failureCount,
                invalidTokens: invalidTokens.length,
                transientFailures
            });
            if (failureDetails.length) {
                logging_1.log.warn('scheduler.token_failures', {
                    docId: doc.id,
                    uid,
                    failures: failureDetails
                });
            }
            if (invalidTokens.length) {
                await usersCollection.doc(uid).set({
                    tokens: firestore_1.FieldValue.arrayRemove(...invalidTokens),
                    updatedAt: firestore_1.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            const baseExpiry = computeNotificationExpiry(data.fireAt || null);
            if (response.successCount === tokens.length) {
                await doc.ref.update({
                    status: 'sent',
                    sentAt: normalizedNow,
                    leaseUntil: null,
                    updatedAt: normalizedNow,
                    expiresAt: baseExpiry,
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                    transientFailures
                });
                continue;
            }
            if (response.successCount > 0) {
                await doc.ref.update({
                    status: 'partial',
                    sentAt: normalizedNow,
                    leaseUntil: null,
                    updatedAt: normalizedNow,
                    expiresAt: baseExpiry,
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                    transientFailures
                });
                continue;
            }
            if (transientFailures > 0) {
                const retryFireAt = firestore_1.Timestamp.fromMillis(normalizedNow.toMillis() + 60 * 1000);
                await doc.ref.update({
                    status: 'pending',
                    leaseUntil: null,
                    updatedAt: normalizedNow,
                    fireAt: retryFireAt,
                    expiresAt: computeNotificationExpiry(retryFireAt),
                    retryCount: firestore_1.FieldValue.increment(1),
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                    transientFailures
                });
                continue;
            }
            const undeliverableReason = invalidTokens.length === tokens.length ? 'invalid_tokens' : 'all_failed';
            await doc.ref.update({
                status: 'undeliverable',
                undeliverableReason,
                undeliverableAt: normalizedNow,
                leaseUntil: null,
                updatedAt: normalizedNow,
                expiresAt: baseExpiry,
                successCount: response.successCount,
                failureCount: response.failureCount,
                transientFailures
            });
        }
        catch (err) {
            logging_1.log.error('scheduler.dispatch_failed', { docId: doc.id }, err);
            const retryFireAt = firestore_1.Timestamp.fromMillis(normalizedNow.toMillis() + 60 * 1000);
            await doc.ref.update({
                status: 'pending',
                leaseUntil: null,
                updatedAt: normalizedNow,
                fireAt: retryFireAt,
                expiresAt: computeNotificationExpiry(retryFireAt),
                retryCount: firestore_1.FieldValue.increment(1)
            });
        }
    }
}
function hasRegisteredNotificationTokens(data) {
    return Array.isArray(data?.tokens) && data.tokens.some((token) => typeof token === 'string' && token.trim());
}
async function countActiveUsers(now = firestore_1.Timestamp.now()) {
    const cutoff = firestore_1.Timestamp.fromMillis(now.toMillis() - ACTIVE_USER_WINDOW_MS);
    const snapshot = await usersCollection.where('presenceLastSeenAt', '>=', cutoff).get();
    return snapshot.docs.reduce((count, doc) => {
        const data = doc.data();
        return data?.presenceState === 'offline' ? count : count + 1;
    }, 0);
}
async function countAnonymousActiveVisitors(now = firestore_1.Timestamp.now()) {
    const cutoff = firestore_1.Timestamp.fromMillis(now.toMillis() - ACTIVE_USER_WINDOW_MS);
    const snapshot = await visitorTelemetryCollection.where('lastSeenAt', '>=', cutoff).get();
    return snapshot.docs.reduce((count, doc) => {
        const data = doc.data();
        return data?.lastAuthState === 'signed_in' ? count : count + 1;
    }, 0);
}
async function countUniqueInteractingVisitors24h(now = firestore_1.Timestamp.now()) {
    const cutoff = firestore_1.Timestamp.fromMillis(now.toMillis() - VISITOR_INTERACTION_WINDOW_MS);
    const snapshot = await visitorTelemetryCollection.where('lastInteractionAt', '>=', cutoff).get();
    return snapshot.size;
}
async function countUsersWithPendingNotifications(now = firestore_1.Timestamp.now()) {
    const pendingSnapshot = await scheduledCollection.where('status', '==', 'pending').get();
    const candidateUserIds = pendingSnapshot.docs.reduce((uids, doc) => {
        const data = doc.data();
        const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';
        const expiresAt = data?.expiresAt;
        if (!uid)
            return uids;
        if (expiresAt?.toMillis?.() && expiresAt.toMillis() <= now.toMillis())
            return uids;
        uids.add(uid);
        return uids;
    }, new Set());
    if (!candidateUserIds.size)
        return 0;
    const uidList = Array.from(candidateUserIds);
    let registeredUserCount = 0;
    for (let index = 0; index < uidList.length; index += FIRESTORE_GET_ALL_CHUNK_SIZE) {
        const refs = uidList
            .slice(index, index + FIRESTORE_GET_ALL_CHUNK_SIZE)
            .map(uid => usersCollection.doc(uid));
        const userDocs = refs.length ? await db.getAll(...refs) : [];
        registeredUserCount += userDocs.reduce((count, userDoc) => {
            return hasRegisteredNotificationTokens(userDoc.data()) ? count + 1 : count;
        }, 0);
    }
    return registeredUserCount;
}
async function logTelemetryCounts(now = firestore_1.Timestamp.now()) {
    const [activeCount, anonymousActiveVisitorsCount, uniqueInteractingVisitors24h, pendingNotificationUsersCount] = await Promise.all([
        countActiveUsers(now),
        countAnonymousActiveVisitors(now),
        countUniqueInteractingVisitors24h(now),
        countUsersWithPendingNotifications(now)
    ]);
    const allActiveVisitorsCount = activeCount + anonymousActiveVisitorsCount;
    await writeGaugeMetrics([
        { type: ACTIVE_USERS_METRIC_TYPE, value: activeCount },
        { type: ALL_ACTIVE_VISITORS_METRIC_TYPE, value: allActiveVisitorsCount },
        { type: ANONYMOUS_ACTIVE_VISITORS_METRIC_TYPE, value: anonymousActiveVisitorsCount },
        { type: UNIQUE_INTERACTING_VISITORS_24H_METRIC_TYPE, value: uniqueInteractingVisitors24h },
        { type: PENDING_NOTIFICATION_USERS_METRIC_TYPE, value: pendingNotificationUsersCount }
    ], now);
    logging_1.log.info('presence.active_user_count', {
        count: activeCount,
        windowMinutes: Math.round(ACTIVE_USER_WINDOW_MS / 60000)
    });
    logging_1.log.info('visitors.active_count', {
        signedInCount: activeCount,
        anonymousCount: anonymousActiveVisitorsCount,
        allCount: allActiveVisitorsCount,
        windowMinutes: Math.round(ACTIVE_USER_WINDOW_MS / 60000)
    });
    logging_1.log.info('visitors.unique_interacting_24h', {
        count: uniqueInteractingVisitors24h
    });
    logging_1.log.info('notifications.pending_registered_user_count', {
        count: pendingNotificationUsersCount
    });
}
exports.scheduledNotificationDispatcher = (0, scheduler_1.onSchedule)({ schedule: 'every 1 minutes', timeZone: 'UTC', region: SCHEDULER_REGION }, async () => {
    await dispatchScheduledNotifications(firestore_1.Timestamp.now());
});
exports.activeUsersTelemetry = (0, scheduler_1.onSchedule)({ schedule: 'every 1 minutes', timeZone: 'UTC', region: SCHEDULER_REGION }, async () => {
    await logTelemetryCounts(firestore_1.Timestamp.now());
});
exports.testDispatchScheduledNotifications = (0, https_1.onRequest)({ cors: true, region: SCHEDULER_REGION }, async (req, res) => {
    if (!assertTestMode(res))
        return;
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).send('Method not allowed');
        return;
    }
    await dispatchScheduledNotifications(firestore_1.Timestamp.now());
    res.json({ status: 'ok' });
});
class SheetsError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function getClientIp(req) {
    const forwarded = req.get('x-forwarded-for') || '';
    const ip = forwarded.split(',')[0]?.trim();
    return ip || req.ip || 'unknown';
}
function rateLimitSheets(req, res) {
    const ip = getClientIp(req);
    const now = Date.now();
    const existing = sheetRateLimit.get(ip);
    if (existing && now < existing.resetAt) {
        if (existing.count >= SHEETS_RATE_LIMIT_MAX) {
            res.status(429).json({ error: 'Too many requests' });
            return false;
        }
        existing.count += 1;
        return true;
    }
    sheetRateLimit.set(ip, { count: 1, resetAt: now + SHEETS_RATE_LIMIT_WINDOW_MS });
    return true;
}
function getCachedValue(cache, key) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    if (entry.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return entry.value;
}
function setCachedValue(cache, key, value, ttlMs) {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
function redactSheetsUrl(rawUrl) {
    if (!rawUrl)
        return rawUrl;
    try {
        const url = new URL(rawUrl);
        if (url.searchParams.has('key')) {
            url.searchParams.set('key', 'REDACTED');
        }
        return url.toString();
    }
    catch (err) {
        return rawUrl.replace(/key=[^&]+/g, 'key=REDACTED');
    }
}
async function readResponseBody(response) {
    try {
        return await response.text();
    }
    catch (err) {
        logging_1.log.warn('sheets.read_response_body_failed', undefined, err);
        return '';
    }
}
function withInFlight(map, key, task) {
    const existing = map.get(key);
    if (existing)
        return existing;
    const promise = task().finally(() => map.delete(key));
    map.set(key, promise);
    return promise;
}
function extractSpreadsheetId(input) {
    if (!input || typeof input !== 'string')
        return null;
    const trimmed = input.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match)
        return match[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed))
        return trimmed;
    return null;
}
function formatSheetRange(sheetTitle, range) {
    const safeTitle = sheetTitle.replace(/'/g, "''");
    return `'${safeTitle}'!${range}`;
}
function normalizeSheetValues(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return { headers: [], rows: [] };
    }
    const rawHeaders = Array.isArray(values[0]) ? values[0] : [];
    const maxRowLength = values.reduce((max, row) => {
        if (!Array.isArray(row))
            return max;
        return Math.max(max, row.length);
    }, 0);
    const width = Math.max(rawHeaders.length, maxRowLength);
    const headers = Array.from({ length: width }).map((_, idx) => {
        const value = rawHeaders[idx];
        return value === undefined || value === null ? '' : String(value);
    });
    const rows = values.slice(1).map(row => {
        const normalizedRow = Array.from({ length: width }).map((_, idx) => {
            const value = Array.isArray(row) ? row[idx] : '';
            return value === undefined || value === null ? '' : String(value);
        });
        return normalizedRow;
    });
    return { headers, rows };
}
function shouldWidenRange(values) {
    if (!Array.isArray(values) || values.length === 0)
        return false;
    const header = Array.isArray(values[0]) ? values[0] : [];
    if (header.length < 26)
        return false;
    const lastCell = header[25];
    if (lastCell === undefined || lastCell === null)
        return false;
    return String(lastCell).trim().length > 0;
}
async function fetchSheetMetadataFromApi(spreadsheetId) {
    const fixture = readFixtureJson('sheets-metadata.json');
    if (fixture) {
        const tabs = Array.isArray(fixture?.sheets)
            ? fixture.sheets
                .map((sheet) => ({
                sheetId: sheet?.properties?.sheetId,
                title: sheet?.properties?.title
            }))
                .filter((sheet) => typeof sheet.sheetId === 'number' && typeof sheet.title === 'string')
            : [];
        return {
            spreadsheetId: fixture?.spreadsheetId || spreadsheetId,
            spreadsheetTitle: fixture?.properties?.title || null,
            tabs,
            fetchedAt: Date.now()
        };
    }
    if (!SHEETS_API_KEY) {
        throw new SheetsError(500, 'Sheets API key is not configured');
    }
    const params = new URLSearchParams({
        key: SHEETS_API_KEY,
        includeGridData: 'false'
    });
    const url = `${SHEETS_API_BASE}/${spreadsheetId}?${params.toString()}`;
    const requestStart = Date.now();
    logging_1.log.info('sheets.metadata_fetch_start', {
        spreadsheetId,
        url: redactSheetsUrl(url)
    });
    const response = await fetch(url);
    const durationMs = Date.now() - requestStart;
    if (response.status === 404) {
        const body = await readResponseBody(response);
        logging_1.log.warn('sheets.metadata_fetch_failed', {
            spreadsheetId,
            status: response.status,
            durationMs,
            bodySnippet: body.slice(0, 400)
        });
        throw new SheetsError(404, 'Spreadsheet not found');
    }
    if (response.status === 403) {
        const body = await readResponseBody(response);
        logging_1.log.warn('sheets.metadata_fetch_failed', {
            spreadsheetId,
            status: response.status,
            durationMs,
            bodySnippet: body.slice(0, 400)
        });
        throw new SheetsError(403, 'Spreadsheet is not publicly accessible');
    }
    if (!response.ok) {
        const body = await readResponseBody(response);
        logging_1.log.warn('sheets.metadata_fetch_failed', {
            spreadsheetId,
            status: response.status,
            durationMs,
            bodySnippet: body.slice(0, 400)
        });
        throw new SheetsError(502, `Sheets API error (${response.status})`);
    }
    const data = await response.json();
    logging_1.log.debug('sheets.metadata_payload', { spreadsheetId, metadata: data });
    logging_1.log.info('sheets.metadata_fetch_ok', {
        spreadsheetId,
        status: response.status,
        durationMs,
        tabCount: Array.isArray(data?.sheets) ? data.sheets.length : 0
    });
    const tabs = Array.isArray(data?.sheets)
        ? data.sheets
            .map((sheet) => ({
            sheetId: sheet?.properties?.sheetId,
            title: sheet?.properties?.title
        }))
            .filter((sheet) => typeof sheet.sheetId === 'number' && typeof sheet.title === 'string')
        : [];
    return {
        spreadsheetId: data?.spreadsheetId || spreadsheetId,
        spreadsheetTitle: data?.properties?.title || null,
        tabs,
        fetchedAt: Date.now()
    };
}
async function fetchSheetValuesRange(spreadsheetId, sheetTitle, rangeEnd) {
    const fixture = readFixtureJson('sheets-values.json');
    if (fixture) {
        const valueRanges = Array.isArray(fixture?.valueRanges) ? fixture.valueRanges : [];
        const values = Array.isArray(valueRanges[0]?.values) ? valueRanges[0].values : [];
        return values;
    }
    if (!SHEETS_API_KEY) {
        throw new SheetsError(500, 'Sheets API key is not configured');
    }
    const range = formatSheetRange(sheetTitle, `A:${rangeEnd}`);
    const params = new URLSearchParams();
    params.append('key', SHEETS_API_KEY);
    params.append('majorDimension', 'ROWS');
    params.append('valueRenderOption', 'FORMATTED_VALUE');
    params.append('dateTimeRenderOption', 'FORMATTED_STRING');
    params.append('ranges', range);
    const url = `${SHEETS_API_BASE}/${spreadsheetId}/values:batchGet?${params.toString()}`;
    const requestStart = Date.now();
    logging_1.log.info('sheets.values_fetch_start', {
        spreadsheetId,
        sheetTitle,
        rangeEnd,
        url: redactSheetsUrl(url)
    });
    const response = await fetch(url);
    const durationMs = Date.now() - requestStart;
    if (response.status === 404) {
        const body = await readResponseBody(response);
        logging_1.log.warn('sheets.values_fetch_failed', {
            spreadsheetId,
            sheetTitle,
            rangeEnd,
            status: response.status,
            durationMs,
            bodySnippet: body.slice(0, 400)
        });
        throw new SheetsError(404, 'Spreadsheet values not found');
    }
    if (response.status === 403) {
        const body = await readResponseBody(response);
        logging_1.log.warn('sheets.values_fetch_failed', {
            spreadsheetId,
            sheetTitle,
            rangeEnd,
            status: response.status,
            durationMs,
            bodySnippet: body.slice(0, 400)
        });
        throw new SheetsError(403, 'Spreadsheet is not publicly accessible');
    }
    if (!response.ok) {
        const body = await readResponseBody(response);
        logging_1.log.warn('sheets.values_fetch_failed', {
            spreadsheetId,
            sheetTitle,
            rangeEnd,
            status: response.status,
            durationMs,
            bodySnippet: body.slice(0, 400)
        });
        throw new SheetsError(502, `Sheets API error (${response.status})`);
    }
    const data = await response.json();
    logging_1.log.info('sheets.values_fetch_ok', {
        spreadsheetId,
        sheetTitle,
        rangeEnd,
        status: response.status,
        durationMs,
        valueRanges: Array.isArray(data?.valueRanges) ? data.valueRanges.length : 0
    });
    const valueRanges = Array.isArray(data?.valueRanges) ? data.valueRanges : [];
    const values = Array.isArray(valueRanges[0]?.values) ? valueRanges[0].values : [];
    return values;
}
async function fetchSheetValuesFromApi(spreadsheetId, sheetTitle) {
    const baseValues = await fetchSheetValuesRange(spreadsheetId, sheetTitle, SHEETS_DEFAULT_RANGE_END);
    if (shouldWidenRange(baseValues)) {
        return await fetchSheetValuesRange(spreadsheetId, sheetTitle, SHEETS_WIDE_RANGE_END);
    }
    return baseValues;
}
async function getSheetMetadata(spreadsheetId, options = {}) {
    const cacheKey = spreadsheetId;
    if (!options.forceRefresh) {
        const cached = getCachedValue(sheetMetadataCache, cacheKey);
        if (cached) {
            logging_1.log.debug('sheets.metadata_cache_hit', {
                spreadsheetId,
                ageMs: Date.now() - cached.fetchedAt,
                tabCount: cached.tabs.length
            });
            return cached;
        }
    }
    if (!options.forceRefresh) {
        const snap = await sheetMetadataCollection.doc(spreadsheetId).get();
        if (snap.exists) {
            const data = snap.data();
            const fetchedAt = data?.lastMetadataFetchAt?.toMillis?.() || 0;
            const tabs = Array.isArray(data?.tabs) ? data.tabs : [];
            if (fetchedAt && Date.now() - fetchedAt < SHEETS_METADATA_TTL_MS && tabs.length) {
                logging_1.log.debug('sheets.metadata_firestore_hit', {
                    spreadsheetId,
                    ageMs: Date.now() - fetchedAt,
                    tabCount: tabs.length
                });
                const metadata = {
                    spreadsheetId,
                    spreadsheetTitle: data?.spreadsheetTitle || null,
                    tabs,
                    fetchedAt
                };
                setCachedValue(sheetMetadataCache, cacheKey, metadata, SHEETS_METADATA_TTL_MS);
                return metadata;
            }
        }
    }
    return withInFlight(sheetMetadataInFlight, cacheKey, async () => {
        const metadata = await fetchSheetMetadataFromApi(spreadsheetId);
        setCachedValue(sheetMetadataCache, cacheKey, metadata, SHEETS_METADATA_TTL_MS);
        await sheetMetadataCollection.doc(spreadsheetId).set({
            spreadsheetId: metadata.spreadsheetId,
            spreadsheetTitle: metadata.spreadsheetTitle,
            tabs: metadata.tabs,
            lastMetadataFetchAt: firestore_1.FieldValue.serverTimestamp(),
            updatedAt: firestore_1.FieldValue.serverTimestamp()
        }, { merge: true });
        return metadata;
    });
}
function sheetDocId(spreadsheetId, sheetId) {
    return `${spreadsheetId}__${sheetId}`;
}
async function getSheetValues(spreadsheetId, sheetId) {
    const cacheKey = `${spreadsheetId}:${sheetId}`;
    const cached = getCachedValue(sheetValuesCache, cacheKey);
    if (cached) {
        logging_1.log.debug('sheets.values_cache_hit', {
            spreadsheetId,
            sheetId,
            ageMs: Date.now() - cached.fetchedAt,
            rows: cached.rows.length
        });
        return cached;
    }
    const fallbackSnap = await sheetSourcesCollection.doc(sheetDocId(spreadsheetId, sheetId)).get();
    let fallback = null;
    if (fallbackSnap.exists) {
        const data = fallbackSnap.data();
        const fetchedAt = data?.lastValuesFetchAt?.toMillis?.() || 0;
        fallback = {
            spreadsheetId,
            spreadsheetTitle: data?.spreadsheetTitle || null,
            sheetId,
            sheetTitle: data?.sheetTitle || 'Sheet',
            headers: Array.isArray(data?.headers) ? data.headers : [],
            rows: Array.isArray(data?.rows)
                ? data.rows.map((row) => (Array.isArray(row?.cells) ? row.cells.map(String) : []))
                : [],
            fetchedAt,
            contentHash: data?.contentHash || ''
        };
        if (fetchedAt && Date.now() - fetchedAt < SHEETS_VALUES_TTL_MS) {
            logging_1.log.debug('sheets.values_firestore_hit', {
                spreadsheetId,
                sheetId,
                ageMs: Date.now() - fetchedAt,
                rows: fallback.rows.length
            });
            setCachedValue(sheetValuesCache, cacheKey, fallback, SHEETS_VALUES_TTL_MS);
            return fallback;
        }
    }
    try {
        return await withInFlight(sheetValuesInFlight, cacheKey, async () => {
            let metadata = await getSheetMetadata(spreadsheetId);
            let tab = metadata.tabs.find(entry => entry.sheetId === sheetId);
            if (!tab) {
                metadata = await getSheetMetadata(spreadsheetId, { forceRefresh: true });
                tab = metadata.tabs.find(entry => entry.sheetId === sheetId);
            }
            if (!tab) {
                throw new SheetsError(404, 'Sheet tab not found');
            }
            const spreadsheetTitle = metadata.spreadsheetTitle || null;
            const rawValues = await fetchSheetValuesFromApi(spreadsheetId, tab.title);
            const normalized = normalizeSheetValues(rawValues);
            const contentHash = (0, crypto_1.createHash)('sha256')
                .update(JSON.stringify({ headers: normalized.headers, rows: normalized.rows }))
                .digest('hex');
            const result = {
                spreadsheetId,
                spreadsheetTitle,
                sheetId,
                sheetTitle: tab.title,
                headers: normalized.headers,
                rows: normalized.rows,
                fetchedAt: Date.now(),
                contentHash
            };
            setCachedValue(sheetValuesCache, cacheKey, result, SHEETS_VALUES_TTL_MS);
            await sheetSourcesCollection.doc(sheetDocId(spreadsheetId, sheetId)).set({
                spreadsheetId,
                spreadsheetTitle,
                sheetId,
                sheetTitle: tab.title,
                headers: normalized.headers,
                rows: normalized.rows.map(cells => ({ cells })),
                contentHash,
                isStale: false,
                lastValuesFetchAt: firestore_1.FieldValue.serverTimestamp(),
                lastSuccessfulParseAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp()
            }, { merge: true });
            return result;
        });
    }
    catch (err) {
        logging_1.log.warn('sheets.values_fetch_failed', { spreadsheetId, sheetId }, err);
        if (fallback) {
            logging_1.log.warn('sheets.values_stale_used', {
                spreadsheetId,
                sheetId,
                ageMs: Date.now() - fallback.fetchedAt,
                rows: fallback.rows.length
            });
            await sheetSourcesCollection.doc(sheetDocId(spreadsheetId, sheetId)).set({
                isStale: true,
                staleReason: err?.message || 'upstream_error',
                staleAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp()
            }, { merge: true });
            return fallback;
        }
        throw err;
    }
}
exports.sheetsApi = (0, https_1.onRequest)({
    cors: true,
    region: SCHEDULER_REGION,
    invoker: 'private',
    secrets: ['SHEETS_API_KEY']
}, async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (!rateLimitSheets(req, res))
        return;
    try {
        const requestId = buildRequestId();
        res.set('x-request-id', requestId);
        let path = (req.path || '').replace(/^\/+/, '');
        if (path.startsWith('api/')) {
            path = path.slice(4);
        }
        logging_1.log.info('sheets.request', {
            requestId,
            method: req.method,
            path,
            ip: getClientIp(req),
            userAgent: req.get('user-agent') || 'unknown',
            hasApiKey: Boolean(SHEETS_API_KEY)
        });
        if (req.method === 'POST' && path === 'sheets/resolve') {
            const { url } = req.body || {};
            const spreadsheetId = extractSpreadsheetId(url);
            logging_1.log.info('sheets.resolve_request', { requestId, spreadsheetId, hasUrl: Boolean(url) });
            if (!spreadsheetId) {
                res.status(400).json({ error: 'Invalid Google Sheets URL' });
                return;
            }
            res.json({ spreadsheetId });
            return;
        }
        const tabsMatch = path.match(/^sheets\/([^/]+)\/tabs$/);
        if (req.method === 'GET' && tabsMatch) {
            const spreadsheetId = tabsMatch[1];
            logging_1.log.info('sheets.tabs_request', { requestId, spreadsheetId });
            const metadata = await getSheetMetadata(spreadsheetId);
            logging_1.log.info('sheets.tabs_response', { requestId, spreadsheetId, tabCount: metadata.tabs.length });
            res.json({
                spreadsheetId: metadata.spreadsheetId,
                spreadsheetTitle: metadata.spreadsheetTitle,
                tabs: metadata.tabs
            });
            return;
        }
        const tabMatch = path.match(/^sheets\/([^/]+)\/tab\/([^/]+)$/);
        if (req.method === 'GET' && tabMatch) {
            const spreadsheetId = tabMatch[1];
            const sheetIdRaw = tabMatch[2];
            const sheetId = Number(sheetIdRaw);
            logging_1.log.info('sheets.tab_values_request', { requestId, spreadsheetId, sheetId });
            if (!Number.isFinite(sheetId)) {
                res.status(400).json({ error: 'sheetId must be a number' });
                return;
            }
            const values = await getSheetValues(spreadsheetId, sheetId);
            logging_1.log.info('sheets.tab_values_response', {
                requestId,
                spreadsheetId,
                sheetId,
                spreadsheetTitle: values.spreadsheetTitle,
                headers: values.headers.length,
                rows: values.rows.length
            });
            res.json({
                spreadsheetId: values.spreadsheetId,
                spreadsheetTitle: values.spreadsheetTitle,
                sheetId: values.sheetId,
                sheetTitle: values.sheetTitle,
                headers: values.headers,
                rows: values.rows
            });
            return;
        }
        res.status(404).json({ error: 'Not found' });
    }
    catch (err) {
        if (err instanceof SheetsError) {
            logging_1.log.warn('sheets.error', {
                status: err.status,
                message: err.message
            });
            res.status(err.status).json({ error: err.message });
            return;
        }
        logging_1.log.error('sheets.unexpected_error', undefined, err);
        res.status(500).json({ error: 'Internal error' });
    }
});
