import type * as arrow from 'apache-arrow';
import * as core from '@ankoh/dashql-core';

import type { LoggerLike, Logger } from '../../platform/logger/logger.js';
import { stringifyError } from '../../platform/logger/logger.js';
import type { AgentCommandParams, AgentCommandResult } from '../../platform/agent/agent_protocol.js';
import { AgentCommandError } from '../../platform/agent/agent_client.js';
import type { ConnectionRegistry } from '../connections/connection_registry.js';
import { ConnectionHealth, type ConnectionState } from '../connections/connection_state.js';
import type { QueryExecutor } from '../connections/query_executor.js';
import {
    CREATE_SCRIPT,
    RENAME_SCRIPT,
    SET_SCRIPT_CONNECTION,
    SET_SCRIPT_TEXT,
    getSelectedScriptRef,
    scriptConnectionOf,
    sessionConnectionIds,
    type ScriptConnection,
    type ScriptData,
    type SessionScripts,
    type SessionScriptsAction,
} from '../session/scripts/session_scripts.js';
import { ensureSessionScriptAnalyzed, type ModifySessionScripts } from '../session/scripts/session_scripts_registry.js';
import { scriptDisplayName } from '../session/scripts/script_types.js';
import { runSessionScriptForResult } from '../session/ui/rerun_query.js';
import { buildSchemaContext } from './agent_catalog.js';
import { loadVega } from '../../ui/vegalite/vegalite_loader.js';
import { arrowTableToRows } from '../../ui/vegalite/vegalite_rows.js';
import { CHART_IMAGE_HEIGHT, CHART_IMAGE_SCALE, CHART_IMAGE_WIDTH, renderVegaLitePng, type ChartImage } from '../../ui/vegalite/vegalite_image.js';
import { DEFAULT_RUN_ROWS, RESULT_PAGE_ROWS, formatResultSlice, sliceResult } from './agent_result_format.js';

/// What the commands of the agent work with
export interface AgentCommandEnvironment {
    /// The scripts of a session, null if the session is gone
    sessionScripts: (sessionId: string) => SessionScripts | null;
    /// Modify the scripts of a session
    modifySessionScripts: (sessionId: string, action: SessionScriptsAction) => Promise<SessionScripts | null>;
    /// The connections of the app
    connections: () => ConnectionRegistry;
    executeQuery: QueryExecutor;
    logger: Logger;
    /// The agent edited a script
    onScriptEdited?: (sessionId: string, scriptKey: number) => void;
    /// The agent ran a script
    onScriptRun?: (sessionId: string, scriptKey: number) => void;
}

function fail(message: string): never {
    throw new AgentCommandError('failed', message);
}

function usage(message: string): never {
    throw new AgentCommandError('usage', message);
}

function stringArg(args: Record<string, unknown>, name: string): string {
    const value = args[name];
    if (typeof value !== 'string' || value.length === 0) usage(`missing ${name}`);
    return value;
}

function numberArg(args: Record<string, unknown>, name: string, fallback: number): number {
    const value = args[name];
    if (value == null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) usage(`${name} must be a positive integer`);
    return value;
}

/// Find a script by its file name or display name, case-insensitive
export function findScript(state: SessionScripts, name: string): ScriptData | null {
    const wanted = scriptDisplayName(name.trim()).toLowerCase();
    for (const fileName of state.scriptOrder) {
        if (scriptDisplayName(fileName).toLowerCase() === wanted) {
            return state.scripts[state.scriptRefs[fileName].scriptId] ?? null;
        }
    }
    return null;
}

function requireScript(state: SessionScripts, name: string): ScriptData {
    const script = findScript(state, name);
    if (script == null) {
        const names = state.scriptOrder.map(scriptDisplayName).join(', ');
        fail(`No script named ${name}. Scripts: ${names.length > 0 ? names : 'none'}`);
    }
    return script;
}

/// A connection of a session as the agent sees it
interface AgentConnection {
    id: string;
    connector: string | null;
    readOnly: boolean | null;
    online: boolean;
}

function describeConnection(env: AgentCommandEnvironment, connectionId: string): AgentConnection {
    const conn = env.connections().connections.get(connectionId);
    if (conn == null) return { id: connectionId, connector: null, readOnly: null, online: false };
    return {
        id: connectionId,
        connector: conn.connectorInfo.names.displayShort,
        readOnly: conn.connectorInfo.features.readOnly,
        online: conn.connectionHealth === ConnectionHealth.ONLINE,
    };
}

/// A connection that the session uses
function requireSessionConnection(state: SessionScripts, connectionId: string): void {
    const ids = sessionConnectionIds(state);
    if (!ids.includes(connectionId)) fail(`The session does not use the connection ${connectionId}. Connections: ${ids.join(', ')}`);
}

/// The connection that the agent picked for a script, null if it picked none
function pickedScriptConnection(env: AgentCommandEnvironment, state: SessionScripts, args: Record<string, unknown>): ScriptConnection | null {
    const connectionId = args.connection;
    if (connectionId == null) return null;
    if (typeof connectionId !== 'string' || connectionId.length === 0) usage('invalid connection');
    requireSessionConnection(state, connectionId);
    const conn = env.connections().connections.get(connectionId);
    if (conn == null) fail(`The connection ${connectionId} is not set up in DashQL, ask the user to connect it`);
    return scriptConnectionOf(conn);
}

function connectionLabel(conn: AgentConnection): string {
    if (conn.connector == null) return conn.id;
    return `${conn.id} (${conn.connector}, ${conn.readOnly ? 'read-only' : 'read-write'}, ${conn.online ? 'online' : 'offline'})`;
}

/// The SHA-256 of a text as hex
async function sha256(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/// The line and column of an offset, one-based
function lineAndColumn(text: string, offset: number): [number, number] {
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < Math.min(offset, text.length); ++i) {
        if (text.charCodeAt(i) === 10) {
            line += 1;
            lineStart = i + 1;
        }
    }
    return [line, offset - lineStart + 1];
}

/// A diagnostic of a script
interface AgentDiagnostic {
    severity: 'error' | 'warning';
    line: number | null;
    column: number | null;
    message: string;
}

function collectDiagnostics(script: ScriptData): AgentDiagnostic[] {
    const text = script.scriptSession.getText();
    return (script.editorUpdate?.diagnostics ?? []).map(diagnostic => {
        const span = diagnostic.textSpan;
        const [line, column] = span == null ? [null, null] : lineAndColumn(text, Number(span.offset));
        return {
            severity: diagnostic.severity === core.buffers.editor.EditorDiagnosticSeverity.WARNING ? 'warning' : 'error',
            line,
            column,
            message: typeof diagnostic.message === 'string' ? diagnostic.message : '',
        };
    });
}

function formatDiagnostics(name: string, diagnostics: AgentDiagnostic[]): string {
    if (diagnostics.length === 0) return `${name}: no diagnostics`;
    return diagnostics.map(d => `${name}:${d.line ?? '?'}:${d.column ?? '?'}: ${d.severity}: ${d.message}`).join('\n');
}

/// Analyze a script if its analysis is outdated
async function analyzed(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, script: ScriptData): Promise<ScriptData> {
    const modify: ModifySessionScripts = action => env.modifySessionScripts(sessionId, action);
    return (await ensureSessionScriptAnalyzed(state, script.scriptKey, modify)) ?? script;
}

async function listScripts(env: AgentCommandEnvironment, state: SessionScripts): Promise<AgentCommandResult> {
    const focused = getSelectedScriptRef(state)?.fileName ?? null;
    const scripts = state.scriptOrder.map(fileName => {
        const script = state.scripts[state.scriptRefs[fileName].scriptId];
        const text = script?.scriptSession.getText() ?? '';
        return {
            name: scriptDisplayName(fileName),
            fileName,
            connectionId: script?.connection.connectionId ?? state.connectionId,
            lines: text.length === 0 ? 0 : text.split('\n').length,
            focused: fileName === focused,
        };
    });
    const connections = sessionConnectionIds(state).map(id => describeConnection(env, id));
    const lines = [
        `Session ${JSON.stringify(state.name ?? '')} (${state.sessionId})`,
        `Default connection: ${connectionLabel(connections[0])}`,
    ];
    const others = connections.slice(1);
    if (others.length > 0) lines.push(`Other connections: ${others.map(connectionLabel).join(', ')}`);
    lines.push(scripts.length === 0 ? 'No scripts' : 'Scripts:');
    for (const script of scripts) {
        const connection = script.connectionId === state.connectionId ? '' : `  on ${script.connectionId}`;
        lines.push(`  ${script.name}  ${script.lines} line${script.lines === 1 ? '' : 's'}${connection}${script.focused ? '  (focused)' : ''}`);
    }
    return { text: lines.join('\n'), data: { session: state.sessionId, name: state.name, defaultConnection: state.connectionId, connections, scripts } };
}

async function editScript(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, args: Record<string, unknown>): Promise<AgentCommandResult> {
    const name = stringArg(args, 'script');
    const text = args.text;
    if (typeof text !== 'string') usage('missing text');
    const base = scriptDisplayName(name.trim());
    if (base.length === 0 || /[/\\\0]/.test(base)) usage(`invalid script name: ${name}`);

    const connection = pickedScriptConnection(env, state, args);
    let script = findScript(state, name);
    let next: SessionScripts | null;
    let created = false;
    if (script != null) {
        if (connection != null && connection.connectionId !== script.connection.connectionId) {
            // The script moves first and keeps its key
            const moved = await env.modifySessionScripts(sessionId, { type: SET_SCRIPT_CONNECTION, value: { fileName: script.fileName, connection } });
            if (moved?.scripts[script.scriptKey]?.connection.connectionId !== connection.connectionId) {
                fail(`Cannot move ${scriptDisplayName(script.fileName)} to the connection ${connection.connectionId}`);
            }
        }
        next = await env.modifySessionScripts(sessionId, { type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text } });
    } else {
        next = await env.modifySessionScripts(sessionId, { type: CREATE_SCRIPT, value: { index: null, text, connection: connection ?? undefined } });
        const createdRef = next == null ? undefined : getSelectedScriptRef(next);
        if (next == null || createdRef == null) fail('Cannot create the script');
        next = await env.modifySessionScripts(sessionId, { type: RENAME_SCRIPT, value: { fileName: createdRef.fileName, newFileName: base } });
        created = true;
        script = next == null ? null : next.scripts[createdRef.scriptId] ?? null;
    }
    if (next == null || script == null) fail('The session is gone');
    const edited = next.scripts[script.scriptKey];
    if (edited == null) fail('The script is gone');
    return reportEdit(env, sessionId, next, edited, created ? 'Created' : 'Updated', { created });
}

/// Analyze an edited script and report its hash and diagnostics
async function reportEdit(
    env: AgentCommandEnvironment,
    sessionId: string,
    state: SessionScripts,
    edited: ScriptData,
    verb: string,
    data: Record<string, unknown>,
): Promise<AgentCommandResult> {
    env.onScriptEdited?.(sessionId, edited.scriptKey);
    const checked = await analyzed(env, sessionId, state, edited);
    const diagnostics = collectDiagnostics(checked);
    const hash = await sha256(checked.scriptSession.getText());
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const fileName = scriptDisplayName(checked.fileName);
    const connectionId = checked.connection.connectionId;
    const on = connectionId === state.connectionId ? '' : ` on ${connectionId}`;
    const lines = [`${verb} ${fileName}${on}: sha256 ${hash}, ${errors} error${errors === 1 ? '' : 's'}, ${diagnostics.length - errors} warning${diagnostics.length - errors === 1 ? '' : 's'}`];
    if (diagnostics.length > 0) lines.push(formatDiagnostics(fileName, diagnostics));
    return { text: lines.join('\n'), data: { script: fileName, ...data, connection: connectionId, sha256: hash, diagnostics } };
}

/// The logger that Vega-Lite reports problems to
type VegaLiteLogger = NonNullable<NonNullable<Parameters<typeof import('vega-lite').compile>[1]>['logger']>;

/// The problems of a Vega-Lite spec: the errors and warnings of compiling it without data
export async function checkVegaLiteSpec(spec: Record<string, unknown>): Promise<string[]> {
    const { vegaLite } = await loadVega();
    const problems: string[] = [];
    const collect = (...message: unknown[]) => {
        problems.push(message.map(m => (typeof m === 'string' ? m : stringifyError(m))).join(' '));
        return logger;
    };
    const logger: VegaLiteLogger = { level: () => logger, error: collect, warn: collect, info: () => logger, debug: () => logger };
    try {
        vegaLite.compile({ ...spec, data: { values: [] } } as Parameters<typeof vegaLite.compile>[0], { logger });
    } catch (e: unknown) {
        problems.push(stringifyError(e));
    }
    return problems;
}

/// Rewrite the `@vis` tag of the terminal query in a scratch script and analyze the result. Returns the
/// rewritten text and the analyzer warnings about the new tag, e.g. fields that are no output columns.
function rewriteVisTag(state: SessionScripts, script: ScriptData, spec: string): [string, string[]] {
    const scratch = state.instance.createScript(script.connection.catalog);
    try {
        scratch.replaceText(script.scriptSession.getText());
        const tag = scratch.rewriteVegaLite(spec);
        scratch.analyze();
        const analyzedPtr = scratch.getAnalyzed();
        const reader = analyzedPtr.read();
        const problems: string[] = [];
        for (let i = 0; i < reader.errorsLength(); ++i) {
            const error = reader.errors(i)!;
            const span = error.textSpan();
            if (error.errorType() !== core.buffers.analyzer.AnalyzerErrorType.INVALID_VIS_TAG || span == null) continue;
            if (span.offset() < tag.offset + tag.length && span.offset() + span.length() > tag.offset) problems.push(error.message() ?? '');
        }
        analyzedPtr.destroy();
        return [scratch.toString(), problems];
    } finally {
        scratch.destroy();
    }
}

/// Visualize the terminal query of a script with a Vega-Lite spec. The spec is checked first: it must be a
/// JSON object that Vega-Lite compiles without warnings, and its fields must be output columns of the query.
async function editVis(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, args: Record<string, unknown>): Promise<AgentCommandResult> {
    const script = requireScript(state, stringArg(args, 'script'));
    const specText = stringArg(args, 'spec');
    const name = scriptDisplayName(script.fileName);
    let spec: unknown;
    try {
        spec = JSON.parse(specText);
    } catch (e: unknown) {
        fail(`The Vega-Lite spec is no valid JSON: ${stringifyError(e)}`);
    }
    if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) fail('The Vega-Lite spec is no JSON object');
    const invalid = (problems: string[]) => fail([`The Vega-Lite spec is invalid, ${name} is unchanged:`, ...problems.map(p => `  ${p}`)].join('\n'));

    const compileProblems = await checkVegaLiteSpec(spec as Record<string, unknown>);
    if (compileProblems.length > 0) invalid(compileProblems);
    let after: string;
    let tagProblems: string[];
    try {
        [after, tagProblems] = rewriteVisTag(state, script, specText);
    } catch (e: unknown) {
        fail(`Cannot visualize ${name}: ${stringifyError(e)}`);
    }
    if (tagProblems.length > 0) invalid(tagProblems);

    const next = await env.modifySessionScripts(sessionId, { type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text: after } });
    const edited = next?.scripts[script.scriptKey];
    if (next == null || edited == null) fail('The script is gone');
    return reportEdit(env, sessionId, next, edited, 'Visualized', {});
}

function describeCatalog(env: AgentCommandEnvironment, state: SessionScripts, args: Record<string, unknown>): AgentCommandResult {
    const connectionId = typeof args.connection === 'string' ? args.connection : state.connectionId;
    requireSessionConnection(state, connectionId);
    const conn: ConnectionState | null = env.connections().connections.get(connectionId) ?? null;
    const schema = buildSchemaContext(connectionId, conn, state, env.logger);
    const text = schema.length > 0 ? schema : '-- The catalog is empty';
    return { text, data: { connection: connectionId, schema } };
}

async function lintScript(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, args: Record<string, unknown>): Promise<AgentCommandResult> {
    const script = await analyzed(env, sessionId, state, requireScript(state, stringArg(args, 'script')));
    const diagnostics = collectDiagnostics(script);
    const name = scriptDisplayName(script.fileName);
    return { text: formatDiagnostics(name, diagnostics), data: { script: name, diagnostics } };
}

async function runScript(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, args: Record<string, unknown>): Promise<AgentCommandResult> {
    const script = requireScript(state, stringArg(args, 'script'));
    const maxRows = numberArg(args, 'maxRows', DEFAULT_RUN_ROWS);
    const name = scriptDisplayName(script.fileName);
    const conn = env.connections().connections.get(script.connection.connectionId);
    if (conn == null || conn.connectionHealth !== ConnectionHealth.ONLINE) {
        fail(`The connection ${script.connection.connectionId} of ${name} is not online, ask the user to connect it`);
    }
    const modify: ModifySessionScripts = action => env.modifySessionScripts(sessionId, action);
    env.onScriptRun?.(sessionId, script.scriptKey);
    let table: arrow.Table | null;
    try {
        table = await runSessionScriptForResult(state, script, env.executeQuery, modify, env.logger as LoggerLike);
    } catch (e: unknown) {
        fail(`${name} failed: ${stringifyError(e)}`);
    }
    if (table == null) {
        return { text: `${name} ran without a result`, data: { script: name, rowCount: 0, columns: [], rows: [], offset: 0 } };
    }
    const slice = sliceResult(table, 0, maxRows);
    return { text: formatResultSlice(slice, name), data: { script: name, ...slice } };
}

/// The result of the last run of a script
function lastResult(env: AgentCommandEnvironment, script: ScriptData): arrow.Table {
    const name = scriptDisplayName(script.fileName);
    const queryId = script.latestResultQueryId ?? script.latestQueryId;
    let table: arrow.Table | null = null;
    if (queryId != null) {
        for (const conn of env.connections().connections.values()) {
            const query = conn.queriesFinished.get(queryId) ?? conn.queriesActive.get(queryId);
            if (query != null) {
                if (query.error != null && query.resultTable == null) fail(`The last run of ${name} failed: ${query.error.message}`);
                table = query.resultTable;
                break;
            }
        }
    }
    if (table == null) fail(`${name} has no result, run it with dashql agent run ${name}`);
    return table;
}

function readResult(env: AgentCommandEnvironment, state: SessionScripts, args: Record<string, unknown>): AgentCommandResult {
    const script = requireScript(state, stringArg(args, 'script'));
    const page = numberArg(args, 'page', 1);
    const name = scriptDisplayName(script.fileName);
    const table = lastResult(env, script);
    const offset = (page - 1) * RESULT_PAGE_ROWS;
    if (offset >= table.numRows && table.numRows > 0) fail(`${name} has ${table.numRows} rows, page ${page} is empty`);
    const slice = sliceResult(table, offset, RESULT_PAGE_ROWS);
    return { text: formatResultSlice(slice, name), data: { script: name, page, ...slice } };
}

/// The chart of a script: its renderer and the Vega-Lite spec of its `@vis vegalite` tag, without the `$schema` and
/// `data` that the compiler adds, so that the spec goes back into `vis edit` as it is
async function getVis(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, args: Record<string, unknown>): Promise<AgentCommandResult> {
    const script = await analyzed(env, sessionId, state, requireScript(state, stringArg(args, 'script')));
    const name = scriptDisplayName(script.fileName);
    const vis = script.annotations.visualizeQuery;
    if (vis == null) fail(`${name} has no chart, add one with dashql agent vis edit ${name}`);
    if (vis.renderer !== 'vegalite') {
        return { text: `${name} shows a ${vis.renderer} @vis tag, no Vega-Lite spec`, data: { script: name, renderer: vis.renderer, spec: null } };
    }
    const spec: Record<string, unknown> = { ...vis.vegaLiteSpec };
    delete spec.$schema;
    delete spec.data;
    return { text: JSON.stringify(spec, null, 2), data: { script: name, renderer: vis.renderer, spec } };
}

/// Bytes as base64
function toBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

/// The limits of chart images, in CSS pixels and pixels per CSS pixel
const MAX_IMAGE_SIZE = 4000;
const MAX_IMAGE_SCALE = 4;

/// Render the chart of a script as PNG: the `@vis vegalite` tag of its last query with the last result as data
async function renderVis(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, args: Record<string, unknown>): Promise<AgentCommandResult> {
    const script = await analyzed(env, sessionId, state, requireScript(state, stringArg(args, 'script')));
    const name = scriptDisplayName(script.fileName);
    const width = numberArg(args, 'width', CHART_IMAGE_WIDTH);
    const height = numberArg(args, 'height', CHART_IMAGE_HEIGHT);
    const scale = numberArg(args, 'scale', CHART_IMAGE_SCALE);
    if (width > MAX_IMAGE_SIZE || height > MAX_IMAGE_SIZE) usage(`width and height must be at most ${MAX_IMAGE_SIZE}`);
    if (scale > MAX_IMAGE_SCALE) usage(`scale must be at most ${MAX_IMAGE_SCALE}`);
    const vis = script.annotations.visualizeQuery;
    if (vis?.renderer !== 'vegalite') fail(`${name} has no Vega-Lite chart, add one with dashql agent vis edit ${name}`);
    const table = lastResult(env, script);
    let image: ChartImage;
    try {
        image = await renderVegaLitePng(vis.vegaLiteSpec, arrowTableToRows(table), { width, height, scale });
    } catch (e: unknown) {
        fail(`Cannot render the chart of ${name}: ${stringifyError(e)}`);
    }
    const kib = Math.max(1, Math.round(image.png.length / 1024));
    return {
        text: `Rendered the chart of ${name}: ${image.width}x${image.height} pixels, ${table.numRows} rows, ${kib} KiB`,
        data: { script: name, width: image.width, height: image.height, rows: table.numRows, png: toBase64(image.png) },
    };
}

/// Run a command of the command line tool against a session
export async function runAgentCommand(env: AgentCommandEnvironment, params: AgentCommandParams): Promise<AgentCommandResult> {
    const state = env.sessionScripts(params.session);
    if (state == null) throw new AgentCommandError('not_connected', `The session ${params.session} is not open in DashQL`);
    const args = params.args ?? {};
    switch (params.command) {
        case 'scripts':
            return listScripts(env, state);
        case 'read': {
            const script = requireScript(state, stringArg(args, 'script'));
            const text = script.scriptSession.getText();
            return { text, data: { script: scriptDisplayName(script.fileName), text } };
        }
        case 'edit':
            return editScript(env, params.session, state, args);
        case 'catalog':
            return describeCatalog(env, state, args);
        case 'lint':
            return lintScript(env, params.session, state, args);
        case 'run':
            return runScript(env, params.session, state, args);
        case 'result':
            return readResult(env, state, args);
        case 'vis.get':
            return getVis(env, params.session, state, args);
        case 'vis.edit':
            return editVis(env, params.session, state, args);
        case 'vis.image':
            return renderVis(env, params.session, state, args);
        default:
            usage(`unknown command: ${params.command}`);
    }
}
