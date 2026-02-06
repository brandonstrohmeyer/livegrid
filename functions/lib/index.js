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
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledNotificationDispatcher = exports.syncScheduledNotifications = exports.sendPushNotification = exports.unregisterPushToken = exports.registerPushToken = exports.nasaFeed = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const crypto_1 = require("crypto");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
const defaultHost = process.env.GCLOUD_PROJECT ? `https://${process.env.GCLOUD_PROJECT}.web.app` : 'https://livegrid.stro.io';
const appPublicUrl = process.env.APP_PUBLIC_URL || defaultHost;
const scheduledCollection = db.collection('scheduledNotifications');
const usersCollection = db.collection('users');
const SCHEDULER_REGION = 'us-central1';
const LEASE_MS = 2 * 60 * 1000;
const DISPATCH_LIMIT = 200;
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
        console.warn('[functions] Failed to verify auth token', err?.message || err);
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
        console.warn('[functions] Failed to hash token for logging', err);
        return 'hash_error';
    }
}
function buildNotifId({ uid, eventId, runGroupId, sessionStartIsoUtc, offsetMinutes }) {
    const raw = `${uid}|${eventId}|${runGroupId}|${sessionStartIsoUtc}|${offsetMinutes}`;
    return (0, crypto_1.createHash)('sha256').update(raw).digest('hex');
}
function parseTimestamp(isoUtc) {
    const date = new Date(isoUtc);
    if (Number.isNaN(date.getTime()))
        return null;
    return admin.firestore.Timestamp.fromDate(date);
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
        const upstream = await fetch('https://nasa-se.com/feed/');
        if (!upstream.ok) {
            console.error('Upstream feed error', upstream.status, upstream.statusText);
            res.status(502).send('Failed to fetch upstream feed');
            return;
        }
        const body = await upstream.text();
        const contentType = upstream.headers.get('content-type') || 'application/rss+xml; charset=utf-8';
        res.set('Content-Type', contentType);
        res.status(200).send(body);
    }
    catch (err) {
        console.error('Error proxying nasa-se feed', err);
        res.status(500).send('Error fetching feed');
    }
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
    console.log('[registerPushToken] Request', {
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
            lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        if (uid) {
            await usersCollection.doc(uid).set({
                tokens: admin.firestore.FieldValue.arrayUnion(token),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log('[registerPushToken] Linked token to user doc', { uid, tokenHash });
        }
        else {
            console.warn('[registerPushToken] Missing auth uid; token not linked to user doc', { tokenHash });
        }
        console.log('[registerPushToken] Stored token', { uid: uid || null, tokenHash });
        res.json({ status: 'registered' });
    }
    catch (err) {
        console.error('Failed to store push token', err);
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
    console.log('[unregisterPushToken] Request', { uid: uid || null, tokenHash });
    try {
        await db.collection('notificationTokens').doc(token).delete();
        if (uid) {
            await usersCollection.doc(uid).set({
                tokens: admin.firestore.FieldValue.arrayRemove(token),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }
        console.log('[unregisterPushToken] Deleted token', { uid: uid || null, tokenHash });
        res.json({ status: 'deleted' });
    }
    catch (err) {
        console.error('Failed to delete push token', err);
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
        console.log('[sendPushNotification] FCM response:', response);
        res.json({ status: 'sent', id: response?.responses?.[0]?.messageId || null, requestedBy: uid || null });
    }
    catch (err) {
        console.error('Failed to send push message', err);
        if (err?.stack)
            console.error('Stack:', err.stack);
        res.status(500).json({ error: 'Failed to send push message', details: err?.message || err });
    }
});
exports.syncScheduledNotifications = (0, https_1.onCall)({ region: SCHEDULER_REGION }, async (request) => {
    if (!request.auth?.uid) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication required');
    }
    const uid = request.auth.uid;
    const { eventId, desiredNotifications } = request.data || {};
    console.log('[syncScheduledNotifications] Request', { uid, eventId, count: Array.isArray(desiredNotifications) ? desiredNotifications.length : 0 });
    if (!eventId || typeof eventId !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'eventId is required');
    }
    if (!Array.isArray(desiredNotifications)) {
        throw new https_1.HttpsError('invalid-argument', 'desiredNotifications must be an array');
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
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
        const existingStatus = existing?.data()?.status;
        if (existing?.exists && existingStatus === 'sent') {
            return;
        }
        const fireAt = parseTimestamp(item.fireAtIsoUtc);
        if (!fireAt) {
            throw new https_1.HttpsError('invalid-argument', `Invalid fireAtIsoUtc for ${notifId}`);
        }
        const docRef = scheduledCollection.doc(notifId);
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
            const reset = existingStatus === 'undeliverable'
                ? {
                    status: 'pending',
                    leaseUntil: null,
                    sentAt: null,
                    undeliverableAt: null,
                    undeliverableReason: null
                }
                : {};
            batch.set(docRef, { ...base, ...reset }, { merge: true });
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
    console.log('[syncScheduledNotifications] Synced', {
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
        if (data.status !== 'pending')
            return;
        if (data.leaseUntil && data.leaseUntil.toMillis() > now.toMillis())
            return;
        tx.update(docRef, {
            status: 'sending',
            leaseUntil: admin.firestore.Timestamp.fromMillis(now.toMillis() + LEASE_MS),
            updatedAt: now
        });
        leased = true;
    });
    return leased;
}
exports.scheduledNotificationDispatcher = (0, scheduler_1.onSchedule)({ schedule: 'every 1 minutes', timeZone: 'UTC', region: SCHEDULER_REGION }, async () => {
    const now = admin.firestore.Timestamp.now();
    const snapshot = await scheduledCollection
        .where('fireAt', '<=', now)
        .orderBy('fireAt')
        .limit(DISPATCH_LIMIT * 3)
        .get();
    if (snapshot.empty) {
        try {
            const nextSnap = await scheduledCollection
                .orderBy('fireAt')
                .limit(1)
                .get();
            if (nextSnap.empty) {
                console.log('[scheduledNotificationDispatcher] No notifications scheduled at', now.toDate().toISOString());
            }
            else {
                const nextDoc = nextSnap.docs[0];
                const nextData = nextDoc.data();
                const nextFireAt = nextData.fireAt?.toDate?.().toISOString?.() || null;
                console.log('[scheduledNotificationDispatcher] No notifications due at', now.toDate().toISOString(), 'next scheduled at', nextFireAt, 'status', nextData.status, 'doc', nextDoc.id);
            }
        }
        catch (err) {
            console.warn('[scheduledNotificationDispatcher] Failed to check next scheduled notification', err?.message || err);
        }
        return;
    }
    console.log('[scheduledNotificationDispatcher] Fetched', snapshot.size, 'docs at', now.toDate().toISOString());
    for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.status !== 'pending') {
            console.log('[scheduledNotificationDispatcher] Skip non-pending doc', doc.id, data.status);
            continue;
        }
        const leased = await leaseNotification(doc.ref, now);
        if (!leased) {
            console.log('[scheduledNotificationDispatcher] Skip lease for doc', doc.id);
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
                console.log('[scheduledNotificationDispatcher] Missing user doc for uid', uid, 'doc', doc.id);
            }
            if (!tokens.length) {
                const reason = userDoc.exists ? 'no_tokens' : 'missing_user_doc';
                console.log('[scheduledNotificationDispatcher] Undeliverable notification', {
                    uid,
                    docId: doc.id,
                    reason,
                    userDocExists: userDoc.exists,
                    tokensCount: tokens.length
                });
                await doc.ref.update({
                    status: 'undeliverable',
                    undeliverableReason: reason,
                    undeliverableAt: now,
                    leaseUntil: null,
                    updatedAt: now
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
                console.log('[scheduledNotificationDispatcher] Token metadata', {
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
            console.log('[scheduledNotificationDispatcher] Dispatch result', {
                docId: doc.id,
                uid,
                tokenCount: tokens.length,
                successCount: response.successCount,
                failureCount: response.failureCount,
                invalidTokens: invalidTokens.length,
                transientFailures
            });
            if (failureDetails.length) {
                console.log('[scheduledNotificationDispatcher] Token failures', {
                    docId: doc.id,
                    uid,
                    failures: failureDetails
                });
            }
            if (invalidTokens.length) {
                await usersCollection.doc(uid).set({
                    tokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
            if (response.successCount === tokens.length) {
                await doc.ref.update({
                    status: 'sent',
                    sentAt: now,
                    leaseUntil: null,
                    updatedAt: now,
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                    transientFailures
                });
                continue;
            }
            if (response.successCount > 0) {
                await doc.ref.update({
                    status: 'partial',
                    sentAt: now,
                    leaseUntil: null,
                    updatedAt: now,
                    successCount: response.successCount,
                    failureCount: response.failureCount,
                    transientFailures
                });
                continue;
            }
            if (transientFailures > 0) {
                await doc.ref.update({
                    status: 'pending',
                    leaseUntil: null,
                    updatedAt: now,
                    fireAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + 60 * 1000),
                    retryCount: admin.firestore.FieldValue.increment(1),
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
                undeliverableAt: now,
                leaseUntil: null,
                updatedAt: now,
                successCount: response.successCount,
                failureCount: response.failureCount,
                transientFailures
            });
        }
        catch (err) {
            console.error('[scheduler] Failed to dispatch notification', doc.id, err?.message || err);
            await doc.ref.update({
                status: 'pending',
                leaseUntil: null,
                updatedAt: now,
                fireAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + 60 * 1000),
                retryCount: admin.firestore.FieldValue.increment(1)
            });
        }
    }
});
