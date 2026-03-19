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
exports.log = void 0;
const logger = __importStar(require("firebase-functions/logger"));
function normalizeError(err) {
    if (!err)
        return undefined;
    if (typeof err === 'string')
        return { message: err };
    if (err instanceof Error) {
        const payload = {
            message: err.message,
            name: err.name,
            stack: err.stack
        };
        const code = err.code;
        if (typeof code === 'string' || typeof code === 'number') {
            payload.code = code;
        }
        return payload;
    }
    if (typeof err === 'object') {
        const payload = { message: 'Unknown error' };
        const maybeMessage = err.message;
        const maybeName = err.name;
        const maybeStack = err.stack;
        const maybeCode = err.code;
        if (typeof maybeMessage === 'string')
            payload.message = maybeMessage;
        if (typeof maybeName === 'string')
            payload.name = maybeName;
        if (typeof maybeStack === 'string')
            payload.stack = maybeStack;
        if (typeof maybeCode === 'string' || typeof maybeCode === 'number')
            payload.code = maybeCode;
        return payload;
    }
    return { message: String(err) };
}
function buildPayload(event, data, err) {
    const payload = { event };
    if (data && typeof data === 'object') {
        Object.assign(payload, data);
    }
    const error = normalizeError(err);
    if (error)
        payload.error = error;
    return payload;
}
exports.log = {
    debug(event, data, err) {
        logger.debug(buildPayload(event, data, err));
    },
    info(event, data, err) {
        logger.info(buildPayload(event, data, err));
    },
    warn(event, data, err) {
        logger.warn(buildPayload(event, data, err));
    },
    error(event, data, err) {
        logger.error(buildPayload(event, data, err));
    }
};
