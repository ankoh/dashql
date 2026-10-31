import * as core from '@ankoh/dashql-core';
import * as Immutable from 'immutable';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { Logger } from '../../../platform/logger/logger.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { PATCH_SESSION_CONNECTION, StorageWriter, WRITE_SESSION_PROPERTIES, WRITE_SESSION_SCRIPTS, type StorageWriteTaskVariant } from '../../storage/storage_writer.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import {
    ANALYZE_OUTDATED_SCRIPT,
    CATALOG_DID_UPDATE,
    CREATE_SCRIPT,
    DELETE_SCRIPT,
    DETACH_CONNECTION,
    MERGE_CONNECTION,
    newScriptConnection,
    type ScriptConnection,
    SET_PENDING_CONNECTION,
    SET_SCRIPT_CONNECTION,
    scriptsOnConnection,
    sessionConnectionIds,
    sessionScriptsMatchStorageSnapshot,
    type SessionScripts,
    reduceSessionScripts,
    SessionScriptsEffects,
    isAnalysisOutdated,
    RENAME_SCRIPT,
    RENAME_SESSION,
    UPDATE_FROM_PROCESSOR,
    UPDATE_SESSION_SETTINGS,
    REORDER_SCRIPTS,
    replaceSessionScriptsFromStorage,
    SET_SCRIPT_TEXT,
    SET_SCRIPT_VIS_SPEC,
    replaceScriptSessionText,
} from './session_scripts.js';
import { compileSessionQuery } from './script_compilation.js';
import { runSessionScript } from '../ui/rerun_query.js';
import { createEmptyAnnotations, createEmptyMetadata, createScriptRef } from './script_types.js';
import { createDefaultSessionSettings, readSessionSettings } from './session_settings.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

class NullLogger extends Logger {
    public destroy(): void {}
    protected flushPendingRecords(): void {}
}

class RecordingWriter extends StorageWriter {
    readonly records: StorageWriteTaskVariant[] = [];
    override async write(_key: string, task: StorageWriteTaskVariant): Promise<boolean> {
        this.records.push(task);
        return true;
    }
}

let dql: core.DashQL;
const logger = new NullLogger();

beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => { vi.restoreAllMocks(); dql.resetUnsafe(); });

/// A connection with a catalog of its own
function connection(type = ConnectorType.HYPER): ScriptConnection {
    return { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[type], catalog: dql.createCatalog() };
}

function state(names = ['1_alpha.sql', '2_beta.sql', '3_gamma.sql'], main: ScriptConnection = connection()): SessionScripts {
    const scripts: SessionScripts['scripts'] = {};
    const refs: SessionScripts['scriptRefs'] = {};
    for (const [index, name] of names.entries()) {
        const scriptSession = dql.createScriptSession(main.catalog);
        replaceScriptSessionText(scriptSession, `SELECT ${index + 1}`);
        const scriptKey = scriptSession.getCatalogEntryId();
        scripts[scriptKey] = {
            scriptKey, scriptSession, editorUpdate: null, analysisOutdated: true,
            annotations: createEmptyAnnotations(), statistics: Immutable.List(), completion: null,
            pendingDiff: null, latestQueryId: null, fileName: name, connection: main,
        };
        refs[name] = createScriptRef(scriptKey, name);
    }
    return {
        instance: dql, sessionId: crypto.randomUUID(), name: 'Test', pendingConnection: names.length === 0 ? main : null,
        settings: { cacheQueryResults: false }, sessionMetadata: createEmptyMetadata(), scripts, scriptRefs: refs, scriptOrder: [...names],
        scriptFocus: { fileName: names[1] ?? names[0] ?? '' }, semanticUserFocus: null,
    };
}

/// The connection of the first script, the fixtures create every script on it
function mainConnection(current: SessionScripts): ScriptConnection {
    return current.scripts[current.scriptRefs[current.scriptOrder[0]].scriptId].connection;
}

function reduce(current: SessionScripts, action: Parameters<typeof reduceSessionScripts>[1], writer?: RecordingWriter) {
    return reduceSessionScripts(current, action, writer ?? new RecordingWriter(logger, new SessionTestBackend()), logger);
}

describe('V2 flat session script mutations', () => {
    it('persists session and script mutations before the connection ever becomes active', () => {
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        let current = state(['1_alpha.sql', '2_beta.sql']);
        for (const action of [
            { type: RENAME_SESSION, value: 'Offline session' },
            { type: RENAME_SCRIPT, value: { fileName: '1_alpha.sql', newFileName: 'offline' } },
            { type: CREATE_SCRIPT, value: { index: 1 } },
        ] as Parameters<typeof reduceSessionScripts>[1][]) {
            current = reduceSessionScripts(current, action, writer, logger);
        }
        expect(current.name).toBe('Offline session');
        current = reduceSessionScripts(current, {
            type: DELETE_SCRIPT, value: current.scriptOrder[0],
        }, writer, logger);
        expect(writer.records.some(task => task.type.description === 'WRITE_SESSION_PROPERTIES')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'WRITE_SCRIPT')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'RENAME_SCRIPT')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'WRITE_SESSION_SCRIPTS')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'DELETE_SCRIPT')).toBe(true);
    });

    it('defers the writes and frees of a reduction until its effects are committed', () => {
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const deleted = current.scripts[current.scriptRefs['1_alpha.sql'].scriptId];
        const effects = new SessionScriptsEffects(writer);
        const next = reduceSessionScripts(current, { type: DELETE_SCRIPT, value: '1_alpha.sql' }, effects, logger);
        expect(next.scriptOrder).toEqual(['2_beta.sql']);
        // A reduction that throws would leave the previous state intact, its effects are never committed
        expect(writer.records).toEqual([]);
        expect(deleted.scriptSession.ptr.isNull()).toBe(false);

        effects.commit();
        expect(writer.records.some(task => task.type.description === 'DELETE_SCRIPT')).toBe(true);
        expect(deleted.scriptSession.ptr.isNull()).toBe(true);
    });

    it('persists settings together with the name and skips unchanged settings', () => {
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        let current = state();
        current = reduceSessionScripts(current, { type: UPDATE_SESSION_SETTINGS, value: { cacheQueryResults: true } }, writer, logger);
        expect(current.settings).toEqual({ cacheQueryResults: true });
        expect(writer.records[writer.records.length - 1]).toEqual({
            type: WRITE_SESSION_PROPERTIES, value: [current.sessionId, { name: 'Test', settings: { cacheQueryResults: true } }],
        });
        const writes = writer.records.length;
        expect(reduceSessionScripts(current, { type: UPDATE_SESSION_SETTINGS, value: { cacheQueryResults: true } }, writer, logger)).toBe(current);
        expect(writer.records).toHaveLength(writes);
    });

    it.each([
        [ConnectorType.HYPER, false],
        [ConnectorType.TRINO, true],
        [ConnectorType.SALESFORCE_DATA_CLOUD, true],
    ])('defaults %s sessions to caching %s, also when settings were never persisted', (type, cacheQueryResults) => {
        expect(createDefaultSessionSettings(CONNECTOR_INFOS[type])).toEqual({ cacheQueryResults });
        expect(readSessionSettings(undefined, CONNECTOR_INFOS[type])).toEqual({ cacheQueryResults });
        expect(readSessionSettings({ cacheQueryResults: !cacheQueryResults }, CONNECTOR_INFOS[type])).toEqual({ cacheQueryResults: !cacheQueryResults });
    });

    it('persists editor text changes with an inactive connection', () => {
        const current = state(['1_alpha.sql']);
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const script = current.scripts[scriptKey];
        script.editorUpdate = script.scriptSession.analyze();
        replaceScriptSessionText(script.scriptSession, 'SELECT 42');
        const editorUpdate = script.scriptSession.analyze();
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        reduceSessionScripts(current, { type: UPDATE_FROM_PROCESSOR, value: {
            scriptKey,
            scriptSession: script.scriptSession,
            editorUpdate,
            scriptBuffers: null,
            scriptCompletion: null,
            scriptPendingDiff: null,
        } }, writer, logger);
        expect(writer.records).toContainEqual(expect.objectContaining({
            value: [current.sessionId, '1_alpha.sql', 'SELECT 42'],
        }));
    });

    it('executes a stale unparseable script verbatim after analysis', async () => {
        const current = state(['1_remote.sql']);
        const sql = 'SELECT * FROM remote_table QUALIFY row_number() OVER (ORDER BY id) = 1;';
        const scriptKey = current.scriptRefs['1_remote.sql'].scriptId;
        replaceScriptSessionText(current.scripts[scriptKey].scriptSession, sql);
        const compiled = current.scripts[scriptKey].scriptSession.compileQuery(new core.buffers.formatting.FormattingConfigT(
            core.buffers.formatting.FormattingDialect.HYPER,
            core.buffers.formatting.FormattingMode.INLINE,
            120,
            2,
            false,
        ));
        expect(compiled.read().errorsLength()).toBeGreaterThan(0);
        expect(compiled.read().sql()).toBe(sql);
        const executeQuery = vi.fn(() => [11, Promise.resolve(null)] as [number, Promise<null>]);
        const modifySessionScripts = vi.fn((action) => action.type === ANALYZE_OUTDATED_SCRIPT
            ? Promise.resolve(reduce(current, action))
            : Promise.resolve(current));

        await runSessionScript(current, current.scripts[scriptKey], executeQuery,
            modifySessionScripts, logger);

        expect(executeQuery).toHaveBeenCalledWith(mainConnection(current).connectionId, expect.objectContaining({
            query: sql,
            cacheable: false,
            cacheSignature: '',
        }));
    });

    it('compiles visualizations in the session connector dialect', () => {
        const current = state(['1_chart.sql']);
        const scriptKey = current.scriptRefs['1_chart.sql'].scriptId;
        const scriptData = current.scripts[scriptKey];
        replaceScriptSessionText(scriptData.scriptSession,
            '/* @vis vegalite {"mark": "bar"} */\nselect cast(payload as array(json)) from events');
        scriptData.scriptSession.analyze();

        const trino = compileSessionQuery(scriptData, ConnectorType.TRINO);
        const hyper = compileSessionQuery(scriptData, ConnectorType.HYPER);
        expect(trino.sql).toContain('cast(payload as array(json))');
        expect(hyper.sql).toContain('cast(payload as json[])');
    });

    it('inserts at an indexed feed boundary and persists the new flat file', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: CREATE_SCRIPT, value: { index: 1 } }, writer);
        const names = next.scriptOrder;
        expect(names).toHaveLength(3);
        expect(next.scriptFocus.fileName).toBe(names[1]);
        expect(writer.records.some(task => task.type.description === 'WRITE_SCRIPT'
            && (task.value as string[])[1] === names[1])).toBe(true);
    });

    it('appends a script with text, analyzes it, and persists the text', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: CREATE_SCRIPT, value: { index: null, text: 'SELECT 42' } }, writer);
        const names = next.scriptOrder;
        expect(names).toHaveLength(3);
        expect(next.scriptFocus.fileName).toBe(names[2]);
        const created = next.scripts[next.scriptRefs[names[2]].scriptId];
        expect(created.scriptSession.getText()).toBe('SELECT 42');
        expect(created.analysisOutdated).toBe(false);
        expect(next.scripts[next.scriptRefs[names[0]].scriptId].analysisOutdated).toBe(true);
        expect(writer.records).toContainEqual(expect.objectContaining({
            value: [current.sessionId, names[2], 'SELECT 42'],
        }));
    });

    it('creates the first script of an empty session', () => {
        const next = reduce(state([]), { type: CREATE_SCRIPT, value: { index: null, text: 'SELECT 1' } });
        const names = next.scriptOrder;
        expect(names).toHaveLength(1);
        expect(next.scriptFocus.fileName).toBe(names[0]);
    });

    it('deletes the last script', () => {
        const current = state(['1_alpha.sql']);
        const next = reduce(current, { type: DELETE_SCRIPT, value: '1_alpha.sql' });
        expect(next.scriptRefs).toEqual({});
        expect(next.scripts).toEqual({});
        expect(next.scriptFocus.fileName).toBe('');
    });

    it('reorders through the script list without renaming files', () => {
        const current = state();
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: REORDER_SCRIPTS, value: ['3_gamma.sql', '1_alpha.sql', '2_beta.sql'] }, writer);
        expect(next.scriptOrder).toEqual(['3_gamma.sql', '1_alpha.sql', '2_beta.sql']);
        expect(next.scriptRefs).toBe(current.scriptRefs);
        expect(next.scriptFocus.fileName).toBe('2_beta.sql');
        expect(writer.records).toEqual([{
            type: WRITE_SESSION_SCRIPTS,
            value: [current.sessionId, {
                scripts: ['3_gamma.sql', '1_alpha.sql', '2_beta.sql'].map(name => ({ name, connectionId: mainConnection(current).connectionId })),
                connections: [],
            }],
        }]);
        // The same order changes nothing
        expect(reduce(next, { type: REORDER_SCRIPTS, value: next.scriptOrder })).toBe(next);
    });

    it('creates scripts without an ordering prefix', () => {
        const next = reduce(state(['1_alpha.sql']), { type: CREATE_SCRIPT, value: { index: 0 } });
        expect(next.scriptOrder).toHaveLength(2);
        expect(next.scriptOrder[1]).toBe('1_alpha.sql');
        expect(next.scriptOrder[0]).not.toMatch(/^\d+_/);
    });

    it('renames in place without keeping the ordering prefix', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: RENAME_SCRIPT, value: { fileName: '2_beta.sql', newFileName: 'report' } }, writer);
        expect(next.scriptRefs['report.sql']).toBeDefined();
        expect(next.scriptOrder).toEqual(['1_alpha.sql', 'report.sql']);
        expect(next.scriptFocus.fileName).toBe('report.sql');
        expect(writer.records).toContainEqual(expect.objectContaining({
            value: [current.sessionId, '2_beta.sql', 'report.sql'],
        }));
        expect(writer.records.some(task => task.type === WRITE_SESSION_SCRIPTS)).toBe(true);
        // The prefix is part of the name the user types
        expect(reduce(next, { type: RENAME_SCRIPT, value: { fileName: 'report.sql', newFileName: '02_report' } }).scriptOrder)
            .toEqual(['1_alpha.sql', '02_report.sql']);
        // Names that are not plain file names are ignored
        expect(reduce(next, { type: RENAME_SCRIPT, value: { fileName: 'report.sql', newFileName: 'a/b' } })).toBe(next);
    });

    it('moves a script to another connection under its script key', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const other = { ...connection(ConnectorType.TRINO), params: { trino: { endpoint: 'https://trino.example' } } as any };
        const scriptKey = current.scriptRefs['2_beta.sql'].scriptId;
        current.scripts[scriptKey] = { ...current.scripts[scriptKey], latestQueryId: 7, latestResultQueryId: 7 };
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: other } }, writer);
        const moved = next.scripts[scriptKey];
        expect(next.scriptRefs['2_beta.sql'].scriptId).toBe(scriptKey);
        expect(moved.connection).toBe(other);
        expect(moved.scriptSession.getText()).toBe('SELECT 2');
        expect(moved.latestQueryId).toBe(7);
        expect(moved.latestResultQueryId).toBe(7);
        expect(writer.records).toEqual([{
            type: WRITE_SESSION_SCRIPTS,
            value: [current.sessionId, {
                scripts: [
                    { name: '1_alpha.sql', connectionId: mainConnection(current).connectionId },
                    { name: '2_beta.sql', connectionId: other.connectionId },
                ],
                // The session file takes a copy of the new connection
                connections: [{ connectionId: other.connectionId, params: other.params }],
            }],
        }]);
        // The same connection changes nothing
        expect(reduce(next, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: other } })).toBe(next);
        // A script moves back under its key
        const back = reduce(next, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: mainConnection(current) } });
        expect(back.scripts[scriptKey].connection.connectionId).toBe(mainConnection(current).connectionId);
    });

    it('creates new scripts on the connection of their neighbors', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const other = { ...connection(ConnectorType.TRINO), params: { trino: { endpoint: 'https://trino.example' } } as any };
        const next = reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: other } });
        // An appended script takes the connection of the last script
        expect(newScriptConnection(next, null)?.connectionId).toBe(other.connectionId);
        // An inserted script takes the connection of the script before it, the first one that of the script after it
        expect(newScriptConnection(next, 1)?.connectionId).toBe(mainConnection(current).connectionId);
        expect(newScriptConnection(next, 2)?.connectionId).toBe(other.connectionId);
        expect(newScriptConnection(next, 0)?.connectionId).toBe(mainConnection(current).connectionId);
        const inserted = reduce(next, { type: CREATE_SCRIPT, value: { index: 1 } });
        expect(inserted.scripts[inserted.scriptRefs[inserted.scriptFocus.fileName].scriptId].connection.connectionId).toBe(mainConnection(current).connectionId);
        expect(sessionConnectionIds(next)).toEqual([mainConnection(current).connectionId, other.connectionId]);
    });

    it('creates the next script on the connection that the user picks', () => {
        const current = state(['1_alpha.sql']);
        const other = { ...connection(ConnectorType.TRINO), params: { trino: { endpoint: 'https://trino.example' } } as any };
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: SET_PENDING_CONNECTION, value: other }, writer);
        expect(next.pendingConnection).toBe(other);
        // The scripts keep their connection, a session with scripts doesn't store the pick
        expect(next.scripts[next.scriptRefs['1_alpha.sql'].scriptId].connection.connectionId).toBe(mainConnection(current).connectionId);
        expect(writer.records).toEqual([]);
        const created = reduce(next, { type: CREATE_SCRIPT, value: { index: null } });
        expect(created.scripts[created.scriptRefs[created.scriptFocus.fileName].scriptId].connection.connectionId).toBe(other.connectionId);
        // The script took the pick
        expect(created.pendingConnection).toBeNull();
        // The same connection changes nothing, a connection without params can't be copied into the session file
        expect(reduce(next, { type: SET_PENDING_CONNECTION, value: other })).toBe(next);
        expect(reduce(current, { type: SET_PENDING_CONNECTION, value: connection() })).toBe(current);
    });

    it('keeps the connection of a session without scripts in its session file', () => {
        const embedded = { ...connection(), params: { hyper: { protocol: 'WASM' } } as any };
        const current = state([], embedded);
        expect(sessionConnectionIds(current)).toEqual([embedded.connectionId]);
        const server = { ...connection(ConnectorType.TRINO), params: { trino: { endpoint: 'https://trino.example' } } as any };
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: SET_PENDING_CONNECTION, value: server }, writer);
        expect(sessionConnectionIds(next)).toEqual([server.connectionId]);
        expect(writer.records).toEqual([{
            type: WRITE_SESSION_SCRIPTS,
            value: [current.sessionId, { scripts: [], connections: [{ connectionId: server.connectionId, params: server.params }] }],
        }]);
        // The first script runs on it, deleting the last script keeps its connection for the next one
        const created = reduce(next, { type: CREATE_SCRIPT, value: { index: null } });
        expect(created.pendingConnection).toBeNull();
        expect(sessionConnectionIds(created)).toEqual([server.connectionId]);
        const deleted = reduce(created, { type: DELETE_SCRIPT, value: created.scriptFocus.fileName });
        expect(deleted.pendingConnection?.connectionId).toBe(server.connectionId);
    });

    it('detaches a connection that only the next script would use', () => {
        const embedded = { ...connection(), params: { hyper: { protocol: 'WASM' } } as any };
        const server = { ...connection(ConnectorType.HYPER), params: { hyper: { protocol: 'V3_HTTP' } } as any };
        // A session without scripts holds the embedded database then
        const empty = reduce(state([], server), { type: DETACH_CONNECTION, value: { from: server.connectionId, into: embedded } });
        expect(empty.pendingConnection).toBe(embedded);
        expect(sessionConnectionIds(empty)).toEqual([embedded.connectionId]);
        // A session with scripts lets go of the pick
        const picked = reduce(state(['1_alpha.sql']), { type: SET_PENDING_CONNECTION, value: server });
        const detached = reduce(picked, { type: DETACH_CONNECTION, value: { from: server.connectionId, into: embedded } });
        expect(detached.pendingConnection).toBeNull();
        expect(sessionConnectionIds(detached)).not.toContain(server.connectionId);
        // Another connection changes nothing
        expect(reduce(detached, { type: DETACH_CONNECTION, value: { from: server.connectionId, into: embedded } })).toBe(detached);
    });

    it('keeps a connection attached while scripts use it', () => {
        const current = state(['1_alpha.sql']);
        const embedded = { ...connection(), params: { hyper: { protocol: 'WASM' } } as any };
        const server = { ...connection(ConnectorType.HYPER), params: { hyper: { protocol: 'V3_HTTP' } } as any };
        let next = reduce(current, { type: SET_PENDING_CONNECTION, value: server });
        next = reduce(next, { type: SET_SCRIPT_CONNECTION, value: { fileName: '1_alpha.sql', connection: server } });
        expect(scriptsOnConnection(next, server.connectionId)).toBe(1);
        expect(reduce(next, { type: DETACH_CONNECTION, value: { from: server.connectionId, into: embedded } })).toBe(next);
    });

    it('completes a script against the catalog of its own connection', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const alpha = current.scripts[current.scriptRefs['1_alpha.sql'].scriptId];
        replaceScriptSessionText(alpha.scriptSession, 'create table only_on_main (a int);');
        alpha.scriptSession.analyze();
        alpha.scriptSession.loadIntoCatalog();
        const completeTables = (next: SessionScripts) => {
            const beta = next.scripts[next.scriptRefs['2_beta.sql'].scriptId];
            const text = 'select * from only_on';
            replaceScriptSessionText(beta.scriptSession, text);
            beta.scriptSession.analyze();
            beta.scriptSession.setCursor(beta.scriptSession.getTextVersion(), BigInt(text.length));
            const completion = beta.scriptSession.completeAtCursor(10);
            const reader = completion.read();
            return Array.from({ length: reader.candidatesLength() }, (_, i) => reader.candidates(i)!.completionText());
        };
        // On the same connection, the table of the other script completes
        expect(completeTables(current)).toContain('only_on_main');
        // On another connection, the table is not visible
        const moved = reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: connection() } });
        expect(completeTables(moved)).not.toContain('only_on_main');
    });

    it('only outdates the scripts of the connection whose catalog changed', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const other = connection();
        let next = reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: other } });
        for (const script of Object.values(next.scripts)) script.analysisOutdated = false;
        next = reduce(next, { type: CATALOG_DID_UPDATE, value: other.connectionId });
        expect(next.scripts[next.scriptRefs['1_alpha.sql'].scriptId].analysisOutdated).toBe(false);
        expect(next.scripts[next.scriptRefs['2_beta.sql'].scriptId].analysisOutdated).toBe(true);
    });

    it('derives an outdated analysis from the versions of the session and its catalog', () => {
        let current = state(['1_table.sql', '2_query.sql']);
        const key = (name: string) => current.scriptRefs[name].scriptId;
        replaceScriptSessionText(current.scripts[key('1_table.sql')].scriptSession, 'create table a (x int)');
        replaceScriptSessionText(current.scripts[key('2_query.sql')].scriptSession, 'select x from a');
        for (let pass = 0; pass < 3; ++pass) {
            for (const name of current.scriptOrder) current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: key(name) });
        }
        const query = current.scripts[key('2_query.sql')];
        expect(isAnalysisOutdated(query)).toBe(false);

        // A change of the catalog that nobody flagged
        current.scripts[key('1_table.sql')].scriptSession.dropFromCatalog();
        expect(query.analysisOutdated).toBe(false);
        expect(isAnalysisOutdated(query)).toBe(true);
        current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: key('2_query.sql') });
        expect(isAnalysisOutdated(current.scripts[key('2_query.sql')])).toBe(false);
    });

    it('outdates the other scripts when a script is deleted', () => {
        let current = state(['1_table.sql', '2_query.sql']);
        const key = (name: string) => current.scriptRefs[name].scriptId;
        replaceScriptSessionText(current.scripts[key('1_table.sql')].scriptSession, 'create table a (x int)');
        replaceScriptSessionText(current.scripts[key('2_query.sql')].scriptSession, 'select x from a');
        for (let pass = 0; pass < 2; ++pass) {
            for (const name of current.scriptOrder) current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: key(name) });
        }
        expect(current.scripts[key('2_query.sql')].analysisOutdated).toBe(false);

        // The query no longer resolves the table of the deleted script
        current = reduce(current, { type: DELETE_SCRIPT, value: '1_table.sql' });
        expect(current.scripts[key('2_query.sql')].analysisOutdated).toBe(true);
    });

    it('outdates the other scripts when a background analysis changes the declarations', () => {
        let current = state(['1_table.sql', '2_view.sql', '3_query.sql']);
        const key = (name: string) => current.scriptRefs[name].scriptId;
        const texts: Record<string, string> = {
            '1_table.sql': 'create table a (x int)',
            '2_view.sql': 'create view v as select * from a',
            '3_query.sql': 'select y from v',
        };
        for (const [name, text] of Object.entries(texts)) replaceScriptSessionText(current.scripts[key(name)].scriptSession, text);
        // Publishing a script outdates the others, analyze until no script is outdated
        for (let pass = 0; pass < 3; ++pass) {
            for (const name of current.scriptOrder) current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: key(name) });
        }
        expect(Object.values(current.scripts).every(script => !script.analysisOutdated)).toBe(true);

        // Adding the column outdates the view and the query
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('1_table.sql'), text: 'create table a (x int, y int)' } });
        expect(current.scripts[key('2_view.sql')].analysisOutdated).toBe(true);
        expect(current.scripts[key('3_query.sql')].analysisOutdated).toBe(true);

        // The query analyzes first and still sees the old view
        current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: key('3_query.sql') });
        expect(current.scripts[key('3_query.sql')].analysisOutdated).toBe(false);
        // The view publishes the new column, so the query is outdated again
        current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: key('2_view.sql') });
        expect(current.scripts[key('3_query.sql')].analysisOutdated).toBe(true);
        current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: key('3_query.sql') });
        const column = current.scripts[key('3_query.sql')].editorUpdate?.semanticSpans
            .find(span => span.kind === core.buffers.editor.EditorSemanticReferenceKind.COLUMN);
        expect(column?.resolution).toBe(core.buffers.editor.EditorSemanticResolution.RESOLVED);
    });

    it('writes the chart spec of the builder into the @vis vegalite tag of the last statement', () => {
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        let current = state(['1_alpha.sql']);
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'create table t (a int);\nselect 2 as x, 3 as y' } });

        // A query without tags gets a new comment in front of the last statement
        current = reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"bar"}' } }, writer);
        let text = current.scripts[scriptKey].scriptSession.getText();
        expect(text.startsWith('create table t (a int);')).toBe(true);
        expect(text).toMatch(/^create table t \(a int\);\n\/\* @vis vegalite\s/);
        const specOf = () => {
            const vis = current.scripts[scriptKey].annotations.visualizeQuery;
            return vis?.renderer === 'vegalite' ? vis.vegaLiteSpec as unknown as Record<string, unknown> : null;
        };
        expect(specOf()?.mark).toBe('bar');
        expect(writer.records.some(task => task.type.description === 'WRITE_SCRIPT')).toBe(true);

        // A card tag survives a rewrite of the renderer
        current = reduce(current, {
            type: SET_SCRIPT_TEXT,
            value: { scriptKey, text: '/* @vis vegalite {"mark":"bar"}\n   @vis card width=4 height=2 */\nselect 2 as x, 3 as y' },
        });
        current = reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"line","encoding":{"x":{"field":"x"}}}' } });
        text = current.scripts[scriptKey].scriptSession.getText();
        expect(text).toContain('@vis card width=4 height=2');
        expect(text).not.toContain('"bar"');
        expect(specOf()).toMatchObject({ mark: 'line', encoding: { x: { field: 'x' } } });

        // An unchanged spec leaves the state alone
        expect(reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"line","encoding":{"x":{"field":"x"}}}' } })).toBe(current);
    });

    it('keeps a failed analysis on the script instead of throwing', () => {
        let current = state(['1_alpha.sql']);
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const failed = { ...current.scripts[scriptKey].scriptSession.analyze(), status: core.buffers.editor.EditorUpdateStatus.ANALYSIS_FAILED, analysisAvailable: false };
        vi.spyOn(current.scripts[scriptKey].scriptSession, 'analyze').mockReturnValue(failed as core.buffers.editor.EditorUpdateT);
        current = reduce(current, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
        expect(current.scripts[scriptKey].analysisOutdated).toBe(false);
        expect(current.scripts[scriptKey].editorUpdate?.analysisAvailable).toBe(false);
    });

    it('moves the scripts and the pending connection of a merged connection', () => {
        const main = connection();
        const current = state(['1_alpha.sql', '2_beta.sql'], main);
        const kept = connection();
        const next = reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: kept } });
        const alphaKey = next.scriptRefs['1_alpha.sql'].scriptId;
        const betaKey = next.scriptRefs['2_beta.sql'].scriptId;
        const target = { ...connection(), params: { hyper: { protocol: 'WASM' } } } as unknown as ConnectionState;
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const merged = reduce(reduce(next, { type: SET_PENDING_CONNECTION, value: { ...main, params: target.params } }),
            { type: MERGE_CONNECTION, value: { from: main.connectionId, into: target } }, writer);
        // The pending connection and the scripts move to the target
        expect(merged.pendingConnection?.connectionId).toBe(target.connectionId);
        expect(merged.scripts[alphaKey].connection.connectionId).toBe(target.connectionId);
        expect(merged.scripts[alphaKey].scriptSession.getText()).toBe('SELECT 1');
        expect(merged.scripts[alphaKey].analysisOutdated).toBe(true);
        // Scripts on other connections stay
        expect(merged.scripts[betaKey].connection).toBe(kept);
        // The session file replaces the merged connection
        expect(writer.records).toContainEqual({
            type: PATCH_SESSION_CONNECTION,
            value: [current.sessionId, { connectionId: target.connectionId, params: target.params }, [main.connectionId]],
        });
        expect(writer.records).toContainEqual({
            type: WRITE_SESSION_SCRIPTS,
            value: [current.sessionId, {
                scripts: [
                    { name: '1_alpha.sql', connectionId: target.connectionId },
                    { name: '2_beta.sql', connectionId: kept.connectionId },
                ],
                connections: [{ connectionId: target.connectionId, params: target.params }],
            }],
        });
        // A connection that the session doesn't use changes nothing
        expect(reduce(merged, { type: MERGE_CONNECTION, value: { from: crypto.randomUUID(), into: target } })).toBe(merged);
    });

    it('deletes the focused script, moves focus, and persists deletion', () => {
        const current = state();
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const next = reduce(current, { type: DELETE_SCRIPT, value: '2_beta.sql' }, writer);
        expect(next.scriptRefs['2_beta.sql']).toBeUndefined();
        expect(next.scriptOrder).toEqual(['1_alpha.sql', '3_gamma.sql']);
        expect(next.scriptFocus.fileName).toBe('1_alpha.sql');
        expect(writer.records).toContainEqual(expect.objectContaining({ value: [current.sessionId, '2_beta.sql'] }));
    });

    it('matches and replaces native flat-script snapshots with their order and connections', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const main = mainConnection(current);
        expect(sessionScriptsMatchStorageSnapshot(current, { scripts: [
            { name: '1_alpha.sql', sql: 'SELECT 1', connection: main },
            { name: '2_beta.sql', sql: 'SELECT 2', connection: main },
        ] })).toBe(true);
        // The order is part of the snapshot
        expect(sessionScriptsMatchStorageSnapshot(current, { scripts: [
            { name: '2_beta.sql', sql: 'SELECT 2', connection: main },
            { name: '1_alpha.sql', sql: 'SELECT 1', connection: main },
        ] })).toBe(false);
        const other = connection();
        const alphaKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const next = replaceSessionScriptsFromStorage(current, { scripts: [
            { name: '3_added.sql', sql: 'SELECT 3', connection: main },
            { name: '1_alpha.sql', sql: 'SELECT changed', connection: other },
        ] }, logger);
        expect(next.scriptOrder).toEqual(['3_added.sql', '1_alpha.sql']);
        expect(next.scriptRefs['1_alpha.sql'].scriptId).toBe(alphaKey);
        expect(next.scripts[alphaKey].scriptSession.getText()).toBe('SELECT changed');
        expect(next.scripts[alphaKey].connection).toBe(other);
        expect(sessionScriptsMatchStorageSnapshot(next, { scripts: [
            { name: '3_added.sql', sql: 'SELECT 3', connection: main },
            { name: '1_alpha.sql', sql: 'SELECT changed', connection: other },
        ] })).toBe(true);
    });

    it('keeps a script usable when it can not move to another connection', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const scriptKey = current.scriptRefs['2_beta.sql'].scriptId;
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        vi.spyOn(dql, 'createScriptSessionWithEntryId').mockImplementation(() => { throw new Error('no session'); });
        expect(reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: connection() } }, writer)).toBe(current);
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe('SELECT 2');
        expect(writer.records).toEqual([]);
    });

    it('keeps the current scripts when the scripts of storage can not be created', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const main = mainConnection(current);
        const alpha = current.scripts[current.scriptRefs['1_alpha.sql'].scriptId];
        // The moved script is created, the added one fails
        vi.spyOn(dql, 'createScriptSession').mockImplementation(() => { throw new Error('no session'); });
        expect(() => replaceSessionScriptsFromStorage(current, { scripts: [
            { name: '1_alpha.sql', sql: 'SELECT 1', connection: connection() },
            { name: '2_beta.sql', sql: 'SELECT 2', connection: main },
            { name: '3_added.sql', sql: 'SELECT 3', connection: main },
        ] }, logger)).toThrow('no session');
        expect(alpha.scriptSession.getText()).toBe('SELECT 1');
        expect(alpha.scriptSession.getCatalogEntryId()).toBe(alpha.scriptKey);
    });

    it('keeps the reference to an unresolved connection until a connection is picked', () => {
        const current = state(['1_alpha.sql']);
        const unknownId = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        current.scripts[scriptKey] = { ...current.scripts[scriptKey], unresolvedConnectionId: unknownId };
        const writer = new RecordingWriter(logger, new SessionTestBackend());
        const created = reduce(current, { type: CREATE_SCRIPT, value: { index: null } }, writer);
        const listOf = (task: StorageWriteTaskVariant) => (task.value as [string, { scripts: Array<{ name: string; connectionId: string }> }])[1].scripts;
        expect(listOf(writer.records.find(task => task.type === WRITE_SESSION_SCRIPTS)!)[0]).toEqual({ name: '1_alpha.sql', connectionId: unknownId });

        // Picking the connection the script runs on replaces the reference
        writer.records.length = 0;
        const picked = reduce(created, { type: SET_SCRIPT_CONNECTION, value: { fileName: '1_alpha.sql', connection: mainConnection(current) } }, writer);
        expect(picked.scripts[scriptKey].unresolvedConnectionId).toBeUndefined();
        expect(picked.scripts[scriptKey].scriptSession).toBe(current.scripts[scriptKey].scriptSession);
        expect(listOf(writer.records[0])[0]).toEqual({ name: '1_alpha.sql', connectionId: mainConnection(current).connectionId });
    });
});
