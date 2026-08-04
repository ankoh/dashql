import { describe, expect, it } from 'vitest';
import type { WatchEvent } from '@tauri-apps/plugin-fs';

import { isSessionContentWatchEvent, nativeSessionWatchForLocation } from './native_session_sync.js';
import { StorageBackendType } from './storage_backend.js';

const DIR = '/tmp/dashql-session';

describe('native session sync', () => {
    it('only creates watches for native session locations', () => {
        expect(nativeSessionWatchForLocation('session', { type: StorageBackendType.OPFS })).toBeNull();
        expect(nativeSessionWatchForLocation('session', {
            type: StorageBackendType.Native,
            nativePath: DIR,
        })).toEqual({ sessionId: 'session', dir: DIR });
    });

    it('ignores access-only watcher events', () => {
        const event: WatchEvent = {
            type: { access: { kind: 'open', mode: 'read' } },
            paths: [`${DIR}/notebook/1_main/1_query.sql`],
            attrs: {},
        };
        expect(isSessionContentWatchEvent(event, DIR)).toBe(false);
    });

    it('ignores unrelated files but accepts reloadable session changes', () => {
        const modify = (path: string): WatchEvent => ({
            type: { modify: { kind: 'data', mode: 'content' } },
            paths: [path],
            attrs: {},
        });
        expect(isSessionContentWatchEvent(modify(`${DIR}/cache/result.arrow`), DIR)).toBe(false);
        expect(isSessionContentWatchEvent(modify(`${DIR}/dashql-session.json`), DIR)).toBe(false);
        expect(isSessionContentWatchEvent(modify(`${DIR}/notebook/1_main/1_query.sql`), DIR)).toBe(true);
        expect(isSessionContentWatchEvent(modify(`${DIR}/dashql-relations.sql`), DIR)).toBe(true);
    });

    it('normalizes windows paths before filtering cache events', () => {
        const event: WatchEvent = {
            type: { create: { kind: 'file' } },
            paths: ['C:\\sessions\\one\\cache\\result.arrow'],
            attrs: {},
        };
        expect(isSessionContentWatchEvent(event, 'C:\\sessions\\one')).toBe(false);
    });
});
