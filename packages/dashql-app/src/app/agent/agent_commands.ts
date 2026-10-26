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
    SET_SCRIPT_TEXT,
    getSelectedScriptRef,
    sessionConnectionIds,
    type ScriptData,
    type SessionScripts,
    type SessionScriptsAction,
} from '../session/scripts/session_scripts.js';
import { ensureSessionScriptAnalyzed, type ModifySessionScripts } from '../session/scripts/session_scripts_registry.js';
import { scriptDisplayName } from '../session/scripts/script_types.js';
import { runSessionScriptForResult } from '../session/ui/rerun_query.js';
import { buildSchemaContext } from '../session/ai/sql_generation.js';
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

function connectionLabel(env: AgentCommandEnvironment, connectionId: string): string {
    const conn = env.connections().connections.get(connectionId);
    if (conn == null) return connectionId;
    const health = conn.connectionHealth === ConnectionHealth.ONLINE ? 'online' : 'offline';
    return `${connectionId} (${conn.connectorInfo.names.displayShort}, ${health})`;
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
    const lines = [
        `Session ${JSON.stringify(state.name ?? '')} (${state.sessionId})`,
        `Default connection: ${connectionLabel(env, state.connectionId)}`,
    ];
    const others = sessionConnectionIds(state).filter(id => id !== state.connectionId);
    if (others.length > 0) lines.push(`Other connections: ${others.map(id => connectionLabel(env, id)).join(', ')}`);
    lines.push(scripts.length === 0 ? 'No scripts' : 'Scripts:');
    for (const script of scripts) {
        const connection = script.connectionId === state.connectionId ? '' : `  on ${script.connectionId}`;
        lines.push(`  ${script.name}  ${script.lines} line${script.lines === 1 ? '' : 's'}${connection}${script.focused ? '  (focused)' : ''}`);
    }
    return { text: lines.join('\n'), data: { session: state.sessionId, name: state.name, defaultConnection: state.connectionId, scripts } };
}

async function editScript(env: AgentCommandEnvironment, sessionId: string, state: SessionScripts, args: Record<string, unknown>): Promise<AgentCommandResult> {
    const name = stringArg(args, 'script');
    const text = args.text;
    if (typeof text !== 'string') usage('missing text');
    const base = scriptDisplayName(name.trim());
    if (base.length === 0 || /[/\\\0]/.test(base)) usage(`invalid script name: ${name}`);

    let script = findScript(state, name);
    let next: SessionScripts | null;
    let created = false;
    if (script != null) {
        next = await env.modifySessionScripts(sessionId, { type: SET_SCRIPT_TEXT, value: { scriptKey: script.scriptKey, text } });
    } else {
        next = await env.modifySessionScripts(sessionId, { type: CREATE_SCRIPT, value: { index: null, text } });
        const createdRef = next == null ? undefined : getSelectedScriptRef(next);
        if (next == null || createdRef == null) fail('Cannot create the script');
        next = await env.modifySessionScripts(sessionId, { type: RENAME_SCRIPT, value: { fileName: createdRef.fileName, newFileName: base } });
        created = true;
        script = next == null ? null : next.scripts[createdRef.scriptId] ?? null;
    }
    if (next == null || script == null) fail('The session is gone');
    const edited = next.scripts[script.scriptKey];
    if (edited == null) fail('The script is gone');
    env.onScriptEdited?.(sessionId, edited.scriptKey);
    const checked = await analyzed(env, sessionId, next, edited);
    const diagnostics = collectDiagnostics(checked);
    const hash = await sha256(checked.scriptSession.getText());
    const errors = diagnostics.filter(d => d.severity === 'error').length;
    const fileName = scriptDisplayName(checked.fileName);
    const lines = [`${created ? 'Created' : 'Updated'} ${fileName}: sha256 ${hash}, ${errors} error${errors === 1 ? '' : 's'}, ${diagnostics.length - errors} warning${diagnostics.length - errors === 1 ? '' : 's'}`];
    if (diagnostics.length > 0) lines.push(formatDiagnostics(fileName, diagnostics));
    return { text: lines.join('\n'), data: { script: fileName, created, sha256: hash, diagnostics } };
}

function describeCatalog(env: AgentCommandEnvironment, state: SessionScripts, args: Record<string, unknown>): AgentCommandResult {
    const connectionId = typeof args.connection === 'string' ? args.connection : state.connectionId;
    if (!sessionConnectionIds(state).includes(connectionId)) {
        fail(`The session does not use the connection ${connectionId}. Connections: ${sessionConnectionIds(state).join(', ')}`);
    }
    const conn: ConnectionState | null = env.connections().connections.get(connectionId) ?? null;
    const schema = buildSchemaContext(conn, state, env.logger);
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

function readResult(env: AgentCommandEnvironment, state: SessionScripts, args: Record<string, unknown>): AgentCommandResult {
    const script = requireScript(state, stringArg(args, 'script'));
    const page = numberArg(args, 'page', 1);
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
    const offset = (page - 1) * RESULT_PAGE_ROWS;
    if (offset >= table.numRows && table.numRows > 0) fail(`${name} has ${table.numRows} rows, page ${page} is empty`);
    const slice = sliceResult(table, offset, RESULT_PAGE_ROWS);
    return { text: formatResultSlice(slice, name), data: { script: name, page, ...slice } };
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
        default:
            usage(`unknown command: ${params.command}`);
    }
}
