import { describe, it, expect } from 'vitest';
import {
    validateSessionData,
    describeInvalidSession,
    describeSessionValidationError,
    SessionValidationError,
} from './session_validation.js';
import type { SessionData, SessionEntry } from './storage_backend.js';
import { ConnectorType } from '../../connection/connector_info.js';

const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function session(extra: Partial<SessionData> = {}): SessionData {
    return {
        sessionId: UUID,
        title: 'Session',
        connectionParams: { dataless: {} },
        notebook: {},
        ...extra,
    } as SessionData;
}

describe('validateSessionData', () => {
    it('accepts a well-formed dataless session', () => {
        expect(validateSessionData(session())).toEqual({ ok: true });
    });

    it('accepts each known connector', () => {
        const hyper = session({ connectionParams: { hyper: {} } as any });
        const sf = session({ connectionParams: { salesforce: {} } as any });
        const trino = session({ connectionParams: { trino: {} } as any });
        expect(validateSessionData(hyper).ok).toBe(true);
        expect(validateSessionData(sf).ok).toBe(true);
        expect(validateSessionData(trino).ok).toBe(true);
    });

    it('rejects a session with an empty sessionId', () => {
        expect(validateSessionData(session({ sessionId: '' }))).toEqual({
            ok: false,
            error: SessionValidationError.MissingSessionId,
        });
    });

    it('rejects a session whose sessionId is not a valid UUID', () => {
        for (const badId of ['imported-1700000000000', 'opfs://sessions/' + UUID, 'not-a-uuid', UUID + '-extra']) {
            expect(validateSessionData(session({ sessionId: badId }))).toEqual({
                ok: false,
                error: SessionValidationError.InvalidSessionId,
            });
        }
    });

    it('accepts an uppercase UUID', () => {
        expect(validateSessionData(session({ sessionId: UUID.toUpperCase() }))).toEqual({ ok: true });
    });

    it('rejects a session with no connectionParams', () => {
        const data = session();
        delete (data as any).connectionParams;
        expect(validateSessionData(data)).toEqual({
            ok: false,
            error: SessionValidationError.MissingConnectionParams,
        });
    });

    it('rejects a session whose connectionParams match no known connector', () => {
        expect(validateSessionData(session({ connectionParams: { garbage: 'data' } as any }))).toEqual({
            ok: false,
            error: SessionValidationError.UnknownConnector,
        });
    });
});

describe('describeSessionValidationError', () => {
    it('produces a human-readable string for every error', () => {
        for (const e of Object.values(SessionValidationError)) {
            const msg = describeSessionValidationError(e);
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(0);
        }
    });

    it('describes an unreadable session as missing files', () => {
        expect(describeSessionValidationError(SessionValidationError.SessionUnreadable))
            .toBe('Session files missing');
    });
});

describe('describeInvalidSession', () => {
    const entry: SessionEntry = { path: UUID };

    it('keys on the manifest entry path and uses session data for title and connector', () => {
        const data = session({ title: 'My Session', connectionParams: { hyper: {} } as any });
        const inv = describeInvalidSession(entry, SessionValidationError.UnknownConnector, data);
        expect(inv.sessionId).toBe(UUID);
        expect(inv.title).toBe('My Session');
        expect(inv.connectorType).toBe(ConnectorType.HYPER);
        expect(inv.error).toBe(SessionValidationError.UnknownConnector);
    });

    it('always uses the manifest entry path as the id, even when session data has a different one', () => {
        // The entry path is the authoritative registry/delete key; a mismatched (or malformed)
        // sessionId in the session data must not become the key.
        const data = session({ sessionId: 'imported-123' });
        const inv = describeInvalidSession({ path: UUID }, SessionValidationError.InvalidSessionId, data);
        expect(inv.sessionId).toBe(UUID);
    });

    it('falls back to the manifest path for the title when session data is absent', () => {
        const inv = describeInvalidSession(entry, SessionValidationError.MissingSessionId, null);
        expect(inv.sessionId).toBe(UUID);
        expect(inv.title).toBe(UUID);
        expect(inv.connectorType).toBeNull();
    });

    it('has a null connector type when params are unknown', () => {
        const data = session({ connectionParams: { garbage: 'data' } as any });
        const inv = describeInvalidSession(entry, SessionValidationError.UnknownConnector, data);
        expect(inv.connectorType).toBeNull();
    });
});
