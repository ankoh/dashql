import * as core from '@ankoh/dashql-core';
import * as Immutable from 'immutable';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TestLogger } from '../../testing/test_logger.js';
import { CONNECTOR_INFOS, ConnectorType, HYPER_CONNECTOR } from '../../connections/connector_info.js';
import { WorkbookTestBackend } from '../../testing/workbook_test_backend.js';
import { PATCH_WORKBOOK_CONNECTION, StorageWriter, WRITE_WORKBOOK_PROPERTIES, WRITE_WORKBOOK_SCRIPTS, type StorageWriteTaskVariant } from '../../storage/storage_writer.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import {
    ANALYZE_OUTDATED_SCRIPT,
    CATALOG_DID_UPDATE,
    CREATE_SCRIPT,
    DELETE_SCRIPT,
    DETACH_CONNECTION,
    REPLACE_CONNECTION,
    newScriptConnection,
    type ScriptConnection,
    SET_PENDING_CONNECTION,
    SET_SCRIPT_CONNECTION,
    scriptsOnConnection,
    workbookConnectionIds,
    workbookScriptsMatchStorageSnapshot,
    type WorkbookScripts,
    reduceWorkbookScripts,
    WorkbookScriptsEffects,
    isAnalysisOutdated,
    RENAME_SCRIPT,
    RENAME_ATTACHMENT,
    SET_WORKBOOK_ATTACHMENTS,
    RENAME_WORKBOOK,
    UPDATE_FROM_PROCESSOR,
    REORDER_SCRIPTS,
    replaceWorkbookScriptsFromStorage,
    SET_SCRIPT_TEXT,
    SET_SCRIPT_VIS_SPEC,
    SET_WORKBOOK_INPUT,
    textChange,
    ACCEPT_PENDING_DIFF,
    REJECT_PENDING_DIFF,
    replaceScriptSessionText,
    createWorkbookScripts,
    REGISTER_QUERY,
    REGISTER_SCRIPT_RESULT,
} from './workbook_scripts.js';
import { runWorkbookScript } from './rerun_query.js';
import { createEmptyMetadata } from './script_types.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

class RecordingWriter extends StorageWriter {
    readonly records: StorageWriteTaskVariant[] = [];
    override async write(_key: string, task: StorageWriteTaskVariant): Promise<boolean> {
        this.records.push(task);
        return true;
    }
}

let dql: core.DashQL;
const logger = new TestLogger();

beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => { vi.restoreAllMocks(); dql.resetUnsafe(); });

/// A connection with a catalog of its own
function connection(type = ConnectorType.HYPER): ScriptConnection {
    return { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[type], catalog: dql.createCatalog() };
}

function state(names = ['1_alpha.sql', '2_beta.sql', '3_gamma.sql'], main: ScriptConnection = connection()): WorkbookScripts {
    return createWorkbookScripts({
        instance: dql, workbookId: crypto.randomUUID(), name: 'Test', pendingConnection: names.length === 0 ? main : null,
        workbookMetadata: createEmptyMetadata(),
        scripts: names.map((name, index) => ({ name, sql: `SELECT ${index + 1}`, connection: main })),
    });
}

/// The connection of the first script, the fixtures create every script on it
function mainConnection(current: WorkbookScripts): ScriptConnection {
    return current.scripts[current.scriptRefs[current.scriptOrder[0]].scriptId].connection;
}

/// The file name of the script that an action created
function createdFile(prev: WorkbookScripts, next: WorkbookScripts): string {
    const fileName = next.scriptOrder.find(name => prev.scriptRefs[name] == null);
    expect(fileName).toBeDefined();
    return fileName!;
}

function reduce(current: WorkbookScripts, action: Parameters<typeof reduceWorkbookScripts>[1], writer?: RecordingWriter) {
    return reduceWorkbookScripts(current, action, writer ?? new RecordingWriter(logger, new WorkbookTestBackend()), logger);
}

describe('V2 flat workbook script mutations', () => {
    it('persists workbook and script mutations before the connection ever becomes active', () => {
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        let current = state(['1_alpha.sql', '2_beta.sql']);
        for (const action of [
            { type: RENAME_WORKBOOK, value: 'Offline workbook' },
            { type: RENAME_SCRIPT, value: { fileName: '1_alpha.sql', newFileName: 'offline' } },
            { type: CREATE_SCRIPT, value: { index: 1 } },
        ] as Parameters<typeof reduceWorkbookScripts>[1][]) {
            current = reduceWorkbookScripts(current, action, writer, logger);
        }
        expect(current.name).toBe('Offline workbook');
        current = reduceWorkbookScripts(current, {
            type: DELETE_SCRIPT, value: current.scriptOrder[0],
        }, writer, logger);
        expect(writer.records.some(task => task.type.description === 'WRITE_WORKBOOK_PROPERTIES')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'WRITE_SCRIPT')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'RENAME_SCRIPT')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'WRITE_WORKBOOK_SCRIPTS')).toBe(true);
        expect(writer.records.some(task => task.type.description === 'DELETE_SCRIPT')).toBe(true);
    });

    it('renames a script past the names of the attachments, a table parameter names one of them', () => {
        let current = state(['1_alpha.sql', '2_beta.sql']);
        current = reduce(current, { type: SET_WORKBOOK_ATTACHMENTS, value: [{ name: 'Sales.parquet', sizeBytes: 1, mtimeMs: 1 }] });
        current = reduce(current, { type: RENAME_SCRIPT, value: { fileName: '1_alpha.sql', newFileName: 'sales' } });
        expect(current.scriptOrder).toEqual(['sales-2.sql', '2_beta.sql']);
        expect(current.attachments?.map(a => [a.fileName, a.name])).toEqual([['Sales.parquet', 'Sales']]);
    });

    it('defers the writes of a reduction until its effects are committed', () => {
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const deleted = current.scripts[current.scriptRefs['1_alpha.sql'].scriptId];
        const effects = new WorkbookScriptsEffects(writer);
        const next = reduceWorkbookScripts(current, { type: DELETE_SCRIPT, value: '1_alpha.sql' }, effects, logger);
        expect(next.scriptOrder).toEqual(['2_beta.sql']);
        // A reduction that throws would leave the storage untouched, its effects are never committed
        expect(writer.records).toEqual([]);
        // The handle of the session of the deleted script goes with it
        expect(deleted.scriptSession.ptr.isNull()).toBe(true);

        effects.commit();
        expect(writer.records.some(task => task.type.description === 'DELETE_SCRIPT')).toBe(true);
    });

    it('persists editor text changes with an inactive connection', () => {
        const current = state(['1_alpha.sql']);
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const script = current.scripts[scriptKey];
        script.editorUpdate = script.scriptSession.analyze();
        replaceScriptSessionText(script.scriptSession, 'SELECT 42');
        const editorUpdate = script.scriptSession.analyze();
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        reduceWorkbookScripts(current, { type: UPDATE_FROM_PROCESSOR, value: {
            scriptKey,
            scriptSession: script.scriptSession,
            editorUpdate,
            scriptPendingDiff: null,
        } }, writer, logger);
        expect(writer.records).toContainEqual(expect.objectContaining({
            value: [current.workbookId, '1_alpha.sql', 'SELECT 42'],
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
        const modifyWorkbookScripts = vi.fn((action) => action.type === ANALYZE_OUTDATED_SCRIPT
            ? Promise.resolve(reduce(current, action))
            : Promise.resolve(current));

        await runWorkbookScript(current, current.scripts[scriptKey], executeQuery,
            modifyWorkbookScripts, logger);

        // The plan of the script passes it through as one statement, its result is not cacheable
        expect(executeQuery).toHaveBeenCalledExactlyOnceWith(mainConnection(current).connectionId, expect.objectContaining({
            query: sql,
            cacheable: false,
        }));
    });

    it('runs no script of a preview of a published workbook', async () => {
        const workbook = state(['1_alpha.sql']);
        const current = { ...workbook, workbookMetadata: { ...workbook.workbookMetadata, cloud: {
            workbookId: 'c0ffee00-0000-4000-8000-000000000001', versionId: 'c0ffee00-0000-4000-8000-000000000002', connectionId: 'cloud', preview: true,
        } } };
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const executeQuery = vi.fn(() => [11, Promise.resolve(null)] as [number, Promise<null>]);
        const modifyWorkbookScripts = vi.fn(() => Promise.resolve(current));
        await runWorkbookScript(current, current.scripts[scriptKey], executeQuery, modifyWorkbookScripts, logger);
        expect(executeQuery).not.toHaveBeenCalled();
        expect(modifyWorkbookScripts).not.toHaveBeenCalled();
        // An input change refuses to write the tags of the preview, its scripts stay as published
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        expect(reduce(current, { type: SET_WORKBOOK_INPUT, value: { name: 'region', literal: "'EU'", scriptKeys: [scriptKey] } }, writer)).toBe(current);
        expect(writer.records).toEqual([]);
    });

    it('inserts at an indexed feed boundary and persists the new flat file', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: CREATE_SCRIPT, value: { index: 1 } }, writer);
        const names = next.scriptOrder;
        expect(names).toHaveLength(3);
        expect(createdFile(current, next)).toBe(names[1]);
        expect(writer.records.some(task => task.type.description === 'WRITE_SCRIPT'
            && (task.value as string[])[1] === names[1])).toBe(true);
    });

    it('appends a script with text, analyzes it, and persists the text', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: CREATE_SCRIPT, value: { index: null, text: 'SELECT 42' } }, writer);
        const names = next.scriptOrder;
        expect(names).toHaveLength(3);
        expect(createdFile(current, next)).toBe(names[2]);
        const created = next.scripts[next.scriptRefs[names[2]].scriptId];
        expect(created.scriptSession.getText()).toBe('SELECT 42');
        expect(created.analysisOutdated).toBe(false);
        expect(next.scripts[next.scriptRefs[names[0]].scriptId].analysisOutdated).toBe(true);
        expect(writer.records).toContainEqual(expect.objectContaining({
            value: [current.workbookId, names[2], 'SELECT 42'],
        }));
    });

    it('creates the first script of an empty workbook', () => {
        const next = reduce(state([]), { type: CREATE_SCRIPT, value: { index: null, text: 'SELECT 1' } });
        expect(next.scriptOrder).toHaveLength(1);
    });

    it('deletes the last script', () => {
        const current = state(['1_alpha.sql']);
        const next = reduce(current, { type: DELETE_SCRIPT, value: '1_alpha.sql' });
        expect(next.scriptRefs).toEqual({});
        expect(next.scripts).toEqual({});
    });

    it('reorders through the script list without renaming files', () => {
        const current = state();
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: REORDER_SCRIPTS, value: ['3_gamma.sql', '1_alpha.sql', '2_beta.sql'] }, writer);
        expect(next.scriptOrder).toEqual(['3_gamma.sql', '1_alpha.sql', '2_beta.sql']);
        expect(next.scriptRefs).toBe(current.scriptRefs);
        expect(writer.records).toEqual([{
            type: WRITE_WORKBOOK_SCRIPTS,
            value: [current.workbookId, {
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

    it('renames the references to a renamed script in the other scripts', () => {
        let current = state(['foo.sql', 'bar.sql', 'baz.sql']);
        const key = (file: string) => current.scriptRefs[file].scriptId;
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('foo.sql'), text: 'select 1 as a' } });
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('bar.sql'), text: "select 'é', f.a from :foo f join :FOO g on true" } });
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('baz.sql'), text: 'select * from :bar, :foo_other' } });
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: RENAME_SCRIPT, value: { fileName: 'foo.sql', newFileName: 'foo 2' } }, writer);
        const bar = next.scripts[key('bar.sql')];
        expect(bar.scriptSession.getText()).toBe(`select 'é', f.a from :"foo 2" f join :"foo 2" g on true`);
        expect(bar.externalChanges?.fromText).toBe("select 'é', f.a from :foo f join :FOO g on true");
        // Other references keep their names
        expect(next.scripts[key('baz.sql')].scriptSession.getText()).toBe('select * from :bar, :foo_other');
        expect(writer.records).toContainEqual(expect.objectContaining({ value: [current.workbookId, 'bar.sql', bar.scriptSession.getText()] }));
    });

    it('renames the references to a renamed attachment in the scripts', () => {
        let current = state(['foo.sql', 'bar.sql']);
        const key = (file: string) => current.scriptRefs[file].scriptId;
        current = reduce(current, { type: SET_WORKBOOK_ATTACHMENTS, value: [{ name: 'sales.parquet', sizeBytes: 1, mtimeMs: 1 }] });
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('foo.sql'), text: 'select * from :sales s join :SALES t on true' } });
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('bar.sql'), text: 'select * from :foo' } });
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: RENAME_ATTACHMENT, value: { fileName: 'sales.parquet', newFileName: 'sales 2024.parquet' } }, writer);
        const foo = next.scripts[key('foo.sql')];
        expect(foo.scriptSession.getText()).toBe('select * from :"sales 2024" s join :"sales 2024" t on true');
        expect(foo.externalChanges?.fromText).toBe('select * from :sales s join :SALES t on true');
        expect(next.scripts[key('bar.sql')].scriptSession.getText()).toBe('select * from :foo');
        expect(next.attachments?.map(a => [a.fileName, a.name])).toEqual([['sales 2024.parquet', 'sales 2024']]);
        expect(writer.records).toContainEqual(expect.objectContaining({ value: [current.workbookId, 'foo.sql', foo.scriptSession.getText()] }));
    });

    it('writes the value of an input into the scripts that use it', () => {
        let current = state(['a.sql', 'b.sql', 'c.sql']);
        const key = (file: string) => current.scriptRefs[file].scriptId;
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('a.sql'), text: '/* @param :min = 1 */\nselect :min::int' } });
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey: key('b.sql'), text: 'select :min' } });
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: SET_WORKBOOK_INPUT, value: { name: 'min', literal: '20', scriptKeys: [key('a.sql'), key('b.sql')] } }, writer);
        const a = next.scripts[key('a.sql')];
        const b = next.scripts[key('b.sql')];
        expect(a.scriptSession.getText()).toBe('/** @param :min = 20 */\nselect :min::int');
        expect(b.scriptSession.getText()).toBe('/** @param :min = 20 */\nselect :min');
        expect(b.externalChanges).toEqual({ fromText: 'select :min', changes: [{ from: 0, to: 0, insert: '/** @param :min = 20 */\n' }] });
        // A script that does not use the input stays
        expect(next.scripts[key('c.sql')]).toBe(current.scripts[key('c.sql')]);
        expect(writer.records).toContainEqual(expect.objectContaining({ value: [current.workbookId, 'b.sql', b.scriptSession.getText()] }));
        // The same value changes nothing
        expect(reduce(next, { type: SET_WORKBOOK_INPUT, value: { name: 'min', literal: '20', scriptKeys: [key('a.sql'), key('b.sql')] } })).toBe(next);
    });

    it('describes a text change by its common prefix and suffix', () => {
        expect(textChange('select 1', 'select 21')).toEqual({ from: 7, to: 7, insert: '2' });
        expect(textChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
        expect(textChange('', 'x')).toEqual({ from: 0, to: 0, insert: 'x' });
    });

    it('renames in place without keeping the ordering prefix', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: RENAME_SCRIPT, value: { fileName: '2_beta.sql', newFileName: 'report' } }, writer);
        expect(next.scriptRefs['report.sql']).toBeDefined();
        expect(next.scriptOrder).toEqual(['1_alpha.sql', 'report.sql']);
        expect(writer.records).toContainEqual(expect.objectContaining({
            value: [current.workbookId, '2_beta.sql', 'report.sql'],
        }));
        expect(writer.records.some(task => task.type === WRITE_WORKBOOK_SCRIPTS)).toBe(true);
        // The prefix is part of the name the user types
        expect(reduce(next, { type: RENAME_SCRIPT, value: { fileName: 'report.sql', newFileName: '02_report' } }).scriptOrder)
            .toEqual(['1_alpha.sql', '02_report.sql']);
        // Names that are not plain file names are ignored
        expect(reduce(next, { type: RENAME_SCRIPT, value: { fileName: 'report.sql', newFileName: 'a/b' } })).toBe(next);
    });

    it('moves a script to another connection under its script key', () => {
        let current = state(['1_alpha.sql', '2_beta.sql']);
        const other = { ...connection(ConnectorType.TRINO), params: { trino: { endpoint: 'https://trino.example' } } as any };
        const scriptKey = current.scriptRefs['2_beta.sql'].scriptId;
        current = reduce(current, { type: REGISTER_QUERY, value: [scriptKey, 7] });
        current = reduce(current, { type: REGISTER_SCRIPT_RESULT, value: [scriptKey, 7] });
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: other } }, writer);
        const moved = next.scripts[scriptKey];
        expect(next.scriptRefs['2_beta.sql'].scriptId).toBe(scriptKey);
        expect(moved.connection).toBe(other);
        expect(moved.scriptSession.getText()).toBe('SELECT 2');
        expect(moved.latestQueryId).toBe(7);
        expect(moved.latestResultQueryId).toBe(7);
        expect(writer.records).toEqual([{
            type: WRITE_WORKBOOK_SCRIPTS,
            value: [current.workbookId, {
                scripts: [
                    { name: '1_alpha.sql', connectionId: mainConnection(current).connectionId },
                    { name: '2_beta.sql', connectionId: other.connectionId },
                ],
                // The workbook file takes a copy of the new connection
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
        expect(inserted.scripts[inserted.scriptRefs[createdFile(next, inserted)].scriptId].connection.connectionId).toBe(mainConnection(current).connectionId);
        expect(workbookConnectionIds(next)).toEqual([mainConnection(current).connectionId, other.connectionId]);
    });

    it('creates the next script on the connection that the user picks', () => {
        const current = state(['1_alpha.sql']);
        const other = { ...connection(ConnectorType.TRINO), params: { trino: { endpoint: 'https://trino.example' } } as any };
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: SET_PENDING_CONNECTION, value: other }, writer);
        expect(next.pendingConnection).toBe(other);
        // The scripts keep their connection, a workbook with scripts doesn't store the pick
        expect(next.scripts[next.scriptRefs['1_alpha.sql'].scriptId].connection.connectionId).toBe(mainConnection(current).connectionId);
        expect(writer.records).toEqual([]);
        // The same connection changes nothing, a connection without params can't be copied into the workbook file
        expect(reduce(next, { type: SET_PENDING_CONNECTION, value: other })).toBe(next);
        expect(reduce(next, { type: SET_PENDING_CONNECTION, value: connection() })).toBe(next);
        const created = reduce(next, { type: CREATE_SCRIPT, value: { index: null } });
        expect(created.scripts[created.scriptRefs[createdFile(next, created)].scriptId].connection.connectionId).toBe(other.connectionId);
        // The script took the pick
        expect(created.pendingConnection).toBeNull();
    });

    it('keeps the connection of a workbook without scripts in its workbook file', () => {
        const embedded = { ...connection(), params: { hyper: { protocol: 'WASM' } } as any };
        const current = state([], embedded);
        expect(workbookConnectionIds(current)).toEqual([embedded.connectionId]);
        const server = { ...connection(ConnectorType.TRINO), params: { trino: { endpoint: 'https://trino.example' } } as any };
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: SET_PENDING_CONNECTION, value: server }, writer);
        expect(workbookConnectionIds(next)).toEqual([server.connectionId]);
        expect(writer.records).toEqual([{
            type: WRITE_WORKBOOK_SCRIPTS,
            value: [current.workbookId, { scripts: [], connections: [{ connectionId: server.connectionId, params: server.params }] }],
        }]);
        // The first script runs on it, deleting the last script keeps its connection for the next one
        const created = reduce(next, { type: CREATE_SCRIPT, value: { index: null } });
        expect(created.pendingConnection).toBeNull();
        expect(workbookConnectionIds(created)).toEqual([server.connectionId]);
        const deleted = reduce(created, { type: DELETE_SCRIPT, value: createdFile(next, created) });
        expect(deleted.pendingConnection?.connectionId).toBe(server.connectionId);
    });

    it('detaches a connection that only the next script would use', () => {
        const embedded = { ...connection(), params: { hyper: { protocol: 'WASM' } } as any };
        const server = { ...connection(ConnectorType.HYPER), params: { hyper: { protocol: 'V3_HTTP' } } as any };
        // A workbook without scripts holds the embedded database then
        const empty = reduce(state([], server), { type: DETACH_CONNECTION, value: { from: server.connectionId, into: embedded } });
        expect(empty.pendingConnection).toBe(embedded);
        expect(workbookConnectionIds(empty)).toEqual([embedded.connectionId]);
        // A workbook with scripts lets go of the pick
        const picked = reduce(state(['1_alpha.sql']), { type: SET_PENDING_CONNECTION, value: server });
        const detached = reduce(picked, { type: DETACH_CONNECTION, value: { from: server.connectionId, into: embedded } });
        expect(detached.pendingConnection).toBeNull();
        expect(workbookConnectionIds(detached)).not.toContain(server.connectionId);
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
        const completeTables = (next: WorkbookScripts) => {
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

    it('derives an outdated analysis from the versions of the workbook and its catalog', () => {
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

    it('stages the chart spec of the builder for the @vis vegalite tag of the last statement', () => {
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        let current = state(['1_alpha.sql']);
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'create table t (a int);\nselect 2 as x, 3 as y' } });

        // A query without tags gets a new comment in front of the last statement
        current = reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"bar"}' } }, writer);
        let text = current.scripts[scriptKey].scriptSession.getText();
        expect(text.startsWith('create table t (a int);')).toBe(true);
        expect(text).toMatch(/^create table t \(a int\);\n\/\*\*\n \* @vis vegalite\n/);
        const specOf = () => {
            const vis = current.scripts[scriptKey].annotations.visualizeQuery;
            return vis?.renderer === 'vegalite' ? vis.vegaLiteSpec as unknown as Record<string, unknown> : null;
        };
        expect(specOf()?.mark).toBe('bar');
        expect(writer.records.some(task => task.type.description === 'WRITE_SCRIPT')).toBe(true);
        // The rewrite waits for the user like a formatting, rejecting it restores the script
        expect(current.scripts[scriptKey].pendingDiff).not.toBeNull();
        current = reduce(current, { type: REJECT_PENDING_DIFF, value: scriptKey });
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe('create table t (a int);\nselect 2 as x, 3 as y');

        // A card tag survives a rewrite of the renderer
        const cardText = '/* @vis vegalite {"mark":"bar"}\n   @board width=4 height=2 */\nselect 2 as x, 3 as y';
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: cardText } });
        current = reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"line","encoding":{"x":{"field":"x"}}}' } });
        text = current.scripts[scriptKey].scriptSession.getText();
        expect(text).toContain('@board width=4 height=2');
        expect(text).not.toContain('"bar"');
        expect(specOf()).toMatchObject({ mark: 'line', encoding: { x: { field: 'x' } } });

        // Every edit of the builder restages the diff against the text before the first edit
        current = reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"point"}' } });
        text = current.scripts[scriptKey].scriptSession.getText();
        expect(text).toContain('@board width=4 height=2');
        expect(specOf()).toEqual(expect.objectContaining({ mark: 'point' }));
        expect(current.scripts[scriptKey].pendingDiff?.priorText).toBe(cardText);

        // An unchanged spec leaves the state alone
        expect(reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"point"}' } })).toBe(current);
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe(text);

        // Rejecting the diff restores the text before the first edit
        current = reduce(current, { type: REJECT_PENDING_DIFF, value: scriptKey });
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe(cardText);
    });

    it('keeps the rewritten text when a staged diff is accepted', () => {
        let current = state(['1_alpha.sql']);
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'select 2 as x, 3 as y' } });
        expect(reduce(current, { type: ACCEPT_PENDING_DIFF, value: scriptKey })).toBe(current);

        current = reduce(current, { type: SET_SCRIPT_VIS_SPEC, value: { scriptKey, spec: '{"mark":"bar"}' } });
        const rewritten = current.scripts[scriptKey].scriptSession.getText();
        current = reduce(current, { type: ACCEPT_PENDING_DIFF, value: scriptKey });
        expect(current.scripts[scriptKey].pendingDiff).toBeNull();
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe(rewritten);
    });

    it('restages a rewrite of a script with a staged diff against the text before it', () => {
        let current = state(['1_alpha.sql']);
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const original = '/* @board width=4 height=2 */\nselect 2 as x';
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: original } });

        const table = '/* @vis table\n   @board width=4 height=2 */\nselect 2 as x';
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: table, withDiff: true } });
        expect(current.scripts[scriptKey].pendingDiff?.priorText).toBe(original);

        // A second rewrite joins the staged diff, rejecting it reverts both
        const moved = '/* @vis table\n   @board width=6 height=2 */\nselect 2 as x';
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: moved, withDiff: true } });
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe(moved);
        expect(current.scripts[scriptKey].pendingDiff?.priorText).toBe(original);
        current = reduce(current, { type: REJECT_PENDING_DIFF, value: scriptKey });
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe(original);
        expect(current.scripts[scriptKey].pendingDiff).toBeNull();

        // A rewrite back to the text before the staged diff drops it
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: table, withDiff: true } });
        current = reduce(current, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: original, withDiff: true } });
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe(original);
        expect(current.scripts[scriptKey].pendingDiff).toBeNull();
    });

    it('moves the scripts and the pending connection of a merged connection', () => {
        const main = connection();
        const current = state(['1_alpha.sql', '2_beta.sql'], main);
        const kept = connection();
        const next = reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: kept } });
        const alphaKey = next.scriptRefs['1_alpha.sql'].scriptId;
        const betaKey = next.scriptRefs['2_beta.sql'].scriptId;
        const target = { ...connection(), params: { hyper: { protocol: 'WASM' } }, details: { type: HYPER_CONNECTOR, value: { proto: {} } } } as unknown as ConnectionState;
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const merged = reduce(reduce(next, { type: SET_PENDING_CONNECTION, value: { ...main, params: target.params } }),
            { type: REPLACE_CONNECTION, value: { from: main.connectionId, into: target } }, writer);
        // The pending connection and the scripts move to the target
        expect(merged.pendingConnection?.connectionId).toBe(target.connectionId);
        expect(merged.scripts[alphaKey].connection.connectionId).toBe(target.connectionId);
        expect(merged.scripts[alphaKey].scriptSession.getText()).toBe('SELECT 1');
        expect(merged.scripts[alphaKey].analysisOutdated).toBe(true);
        // Scripts on other connections stay
        expect(merged.scripts[betaKey].connection).toBe(kept);
        // The workbook file replaces the merged connection
        expect(writer.records).toContainEqual({
            type: PATCH_WORKBOOK_CONNECTION,
            value: [current.workbookId, { connectionId: target.connectionId, params: target.params }, [main.connectionId]],
        });
        expect(writer.records).toContainEqual({
            type: WRITE_WORKBOOK_SCRIPTS,
            value: [current.workbookId, {
                scripts: [
                    { name: '1_alpha.sql', connectionId: target.connectionId },
                    { name: '2_beta.sql', connectionId: kept.connectionId },
                ],
                connections: [{ connectionId: target.connectionId, params: target.params }],
            }],
        });
        // A connection that the workbook doesn't use changes nothing
        expect(reduce(merged, { type: REPLACE_CONNECTION, value: { from: crypto.randomUUID(), into: target } })).toBe(merged);
    });

    it('deletes a script and persists the deletion', () => {
        const current = state();
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const next = reduce(current, { type: DELETE_SCRIPT, value: '2_beta.sql' }, writer);
        expect(next.scriptRefs['2_beta.sql']).toBeUndefined();
        expect(next.scriptOrder).toEqual(['1_alpha.sql', '3_gamma.sql']);
        expect(writer.records).toContainEqual(expect.objectContaining({ value: [current.workbookId, '2_beta.sql'] }));
    });

    it('matches and replaces native flat-script snapshots with their order and connections', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const main = mainConnection(current);
        expect(workbookScriptsMatchStorageSnapshot(current, { scripts: [
            { name: '1_alpha.sql', sql: 'SELECT 1', connection: main },
            { name: '2_beta.sql', sql: 'SELECT 2', connection: main },
        ] })).toBe(true);
        // The order is part of the snapshot
        expect(workbookScriptsMatchStorageSnapshot(current, { scripts: [
            { name: '2_beta.sql', sql: 'SELECT 2', connection: main },
            { name: '1_alpha.sql', sql: 'SELECT 1', connection: main },
        ] })).toBe(false);
        const other = connection();
        const alphaKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const next = replaceWorkbookScriptsFromStorage(current, { scripts: [
            { name: '3_added.sql', sql: 'SELECT 3', connection: main },
            { name: '1_alpha.sql', sql: 'SELECT changed', connection: other },
        ] }, logger);
        expect(next.scriptOrder).toEqual(['3_added.sql', '1_alpha.sql']);
        expect(next.scriptRefs['1_alpha.sql'].scriptId).toBe(alphaKey);
        expect(next.scripts[alphaKey].scriptSession.getText()).toBe('SELECT changed');
        expect(next.scripts[alphaKey].connection).toBe(other);
        expect(workbookScriptsMatchStorageSnapshot(next, { scripts: [
            { name: '3_added.sql', sql: 'SELECT 3', connection: main },
            { name: '1_alpha.sql', sql: 'SELECT changed', connection: other },
        ] })).toBe(true);
    });

    it('replaces the text of a stored script that stays on its connection', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const main = mainConnection(current);
        const alphaKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const alpha = current.scripts[alphaKey];
        current.scripts[alphaKey] = { ...alpha, analysisOutdated: false, pendingDiff: {} as never };
        const unknownId = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
        const next = replaceWorkbookScriptsFromStorage(current, { scripts: [
            { name: '1_alpha.sql', sql: 'SELECT changed', connection: main, unresolvedConnectionId: unknownId },
        ] }, logger);
        expect(next.scriptOrder).toEqual(['1_alpha.sql']);
        expect(next.scriptRefs['2_beta.sql']).toBeUndefined();
        const replaced = next.scripts[alphaKey];
        // The script keeps its session and drops what belonged to the old text
        expect(replaced.scriptSession).toBe(alpha.scriptSession);
        expect(replaced.scriptSession.getText()).toBe('SELECT changed');
        expect(replaced.pendingDiff).toBeNull();
        expect(replaced.analysisOutdated).toBe(true);
        expect(replaced.unresolvedConnectionId).toBe(unknownId);
    });

    it('keeps the analysis of scripts that storage did not change', () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const main = mainConnection(current);
        for (const key in current.scripts) {
            current.scripts[key] = { ...current.scripts[key], analysisOutdated: false };
        }
        const next = replaceWorkbookScriptsFromStorage(current, { scripts: [
            { name: '1_alpha.sql', sql: 'SELECT 1', connection: main },
            { name: '2_beta.sql', sql: 'SELECT 2', connection: main },
            // A duplicate entry of storage is ignored
            { name: '1_alpha.sql', sql: 'SELECT other', connection: main },
        ] }, logger);
        expect(next.scriptOrder).toEqual(['1_alpha.sql', '2_beta.sql']);
        expect(Object.values(next.scripts).map(script => script.analysisOutdated)).toEqual([false, false]);
        expect(next.scripts[next.scriptRefs['1_alpha.sql'].scriptId].scriptSession.getText()).toBe('SELECT 1');
    });

    /// A connection whose catalog belongs to another instance of the core, the workbook can't take it
    async function foreignConnection(): Promise<ScriptConnection> {
        // An instance of its own over the same module, the test frames may share the instances of `DashQL.create`
        const foreign = new core.DashQL(dql.bindings);
        return { connectionId: crypto.randomUUID(), connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: foreign.createCatalog() };
    }

    it('keeps a script usable when it can not move to another connection', async () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const scriptKey = current.scriptRefs['2_beta.sql'].scriptId;
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const foreign = await foreignConnection();
        expect(reduce(current, { type: SET_SCRIPT_CONNECTION, value: { fileName: '2_beta.sql', connection: foreign } }, writer)).toBe(current);
        expect(current.scripts[scriptKey].scriptSession.getText()).toBe('SELECT 2');
        expect(writer.records).toEqual([]);
    });

    it('keeps the current scripts when the scripts of storage can not be created', async () => {
        const current = state(['1_alpha.sql', '2_beta.sql']);
        const main = mainConnection(current);
        const alpha = current.scripts[current.scriptRefs['1_alpha.sql'].scriptId];
        const foreign = await foreignConnection();
        expect(() => replaceWorkbookScriptsFromStorage(current, { scripts: [
            { name: '1_alpha.sql', sql: 'SELECT 1', connection: connection() },
            { name: '2_beta.sql', sql: 'SELECT 2', connection: main },
            { name: '3_added.sql', sql: 'SELECT 3', connection: foreign },
        ] }, logger)).toThrow('different DashQL instance');
        expect(current.native!.workbook.view().scripts.map(([key]) => key)).toEqual(Object.keys(current.scripts).map(Number));
        expect(alpha.scriptSession.getText()).toBe('SELECT 1');
        expect(alpha.scriptSession.getCatalogEntryId()).toBe(alpha.scriptKey);
    });

    it('keeps the reference to an unresolved connection until a connection is picked', () => {
        const unknownId = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
        const current = createWorkbookScripts({
            instance: dql, workbookId: crypto.randomUUID(), name: 'Test', pendingConnection: null, workbookMetadata: createEmptyMetadata(),
            scripts: [{ name: '1_alpha.sql', sql: 'SELECT 1', connection: connection(), unresolvedConnectionId: unknownId }],
        });
        const scriptKey = current.scriptRefs['1_alpha.sql'].scriptId;
        const writer = new RecordingWriter(logger, new WorkbookTestBackend());
        const created = reduce(current, { type: CREATE_SCRIPT, value: { index: null } }, writer);
        const listOf = (task: StorageWriteTaskVariant) => (task.value as [string, { scripts: Array<{ name: string; connectionId: string }> }])[1].scripts;
        expect(listOf(writer.records.find(task => task.type === WRITE_WORKBOOK_SCRIPTS)!)[0]).toEqual({ name: '1_alpha.sql', connectionId: unknownId });

        // Picking the connection the script runs on replaces the reference
        writer.records.length = 0;
        const picked = reduce(created, { type: SET_SCRIPT_CONNECTION, value: { fileName: '1_alpha.sql', connection: mainConnection(current) } }, writer);
        expect(picked.scripts[scriptKey].unresolvedConnectionId).toBeUndefined();
        expect(picked.scripts[scriptKey].scriptSession).toBe(current.scripts[scriptKey].scriptSession);
        expect(listOf(writer.records[0])[0]).toEqual({ name: '1_alpha.sql', connectionId: mainConnection(current).connectionId });
    });
});
