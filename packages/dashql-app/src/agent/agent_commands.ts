// The `dashql` commands of an agent, answered by the page on the workbook that it shows (docs/design/agent_integration.md):
// the main process of the desktop app passes every call of the command line tool to the page, the page changes and runs
// the live workbook and answers with text and an exit code
import * as vegaLite from 'vega-lite';
import * as core from '@akohn/dashql';
import type * as arrow from 'apache-arrow';

import { ConnectionHealth, connectorInfoOf, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { CHART_IMAGE_HEIGHT, CHART_IMAGE_SCALE, CHART_IMAGE_WIDTH, chartSpecProblems, compileProblems, type VegaLiteCompile } from '@akohn/dashql/platform/workbook/chart_config';
import { KPI_CHECK_ROWS, kpiProblems, readKpi } from '@akohn/dashql/platform/workbook/kpi_reading';
import type { RunEvent } from '@akohn/dashql/platform/workbook/run_events';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import type { ScriptData, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { WorkbookResultFiles } from '@akohn/dashql/platform/workbook/workbook_result_files';
import { stringifyError, type Logger } from '@akohn/dashql/platform/logger/logger';
import { describeRunError, runScriptsOf, runWorkbookReported } from '@akohn/dashql/runtime/workbook_run_report';
import type { Runtime } from '@akohn/dashql/runtime/runtime';

import { renderVegaLitePng } from '@akohn/dashql-react/vegalite/vegalite_image';
import { arrowTableToRows } from '@akohn/dashql-react/vegalite/vegalite_rows';

import { createScriptFormatConfig, formatSqlText, formattingDialectForConnector } from '../workbook/scripts/script_format.js';
import { agentConnections } from './agent_connections.js';
import { describeKpi, diagnosticsText, plural, RunText, type AgentDiagnostic } from './agent_output.js';

const LOG_CTX = 'agent_commands';

/// The exit codes of the command line tool
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

/// The rows of a result that `run` prints by default, and at most
export const DEFAULT_RUN_ROWS = 10;
export const MAX_RUN_ROWS = 10000;

/// A call of a command of the agent
export interface AgentCall {
    workbookId: string;
    command: string;
    args: Record<string, unknown>;
    input: string | null;
}

/// Where the feed follows the agent to: the text of a script it edits or the results of a script it runs
export type AgentFollowTarget = 'script' | 'result';

/// What the commands need of the page, the tests pass their own
export interface AgentCommandHost {
    runtime: Runtime;
    /// The stored results of the workbooks, null without them
    results: WorkbookResultFiles | null;
    /// May the agent use a connection?
    isConnectionAllowed: (connectionId: string) => boolean;
    /// Write a file of a call into the folder of the agent, resolves with its path relative to the folder
    writeFile: (workbookId: string, kind: 'chart' | 'result', name: string, data: Uint8Array) => Promise<string>;
    /// The agent edited or created a script of a workbook
    onEdited: (workbookId: string, fileName: string) => void;
    /// Follow the agent to a script of a workbook
    onFollow: (workbookId: string, scriptKey: number, target: AgentFollowTarget) => void;
    logger: Logger;
}

/// The answer of a call: text for stdout and stderr, the exit code ends it
export interface AgentReplyStream {
    out: (text: string) => void;
    err: (text: string) => void;
}

/// A failure of a command with its exit code
class CommandError extends Error {
    constructor(readonly code: number, message: string) {
        super(message);
    }
}

function fail(message: string): never {
    throw new CommandError(EXIT_FAILED, message);
}

function usage(message: string): never {
    throw new CommandError(EXIT_USAGE, message);
}

function stringArg(args: Record<string, unknown>, name: string): string {
    const value = args[name];
    if (typeof value !== 'string' || value.length === 0) usage(`missing ${name}`);
    return value;
}

function optionalString(args: Record<string, unknown>, name: string): string | null {
    const value = args[name];
    if (value == null) return null;
    if (typeof value !== 'string' || value.length === 0) usage(`invalid ${name}`);
    return value;
}

function integerArg(args: Record<string, unknown>, name: string, fallback: number, min: number, max: number): number {
    const value = args[name];
    if (value == null) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) usage(`${name} takes a number from ${min} to ${max}`);
    return value;
}

/// The file name of a script that the agent named: `orders`, `orders.sql` or `scripts/orders.sql`
export function scriptFileName(name: string): string {
    const base = name.trim().split(/[\\/]/).pop() ?? name;
    return base.endsWith('.sql') ? base : `${base}.sql`;
}

/// The workbook of a call
function workbookOf(runtime: Runtime, workbookId: string): WorkbookScripts {
    const workbook = runtime.store.get('workbook', workbookId);
    if (workbook == null) fail('DashQL has no such workbook open, the user may have deleted it');
    return workbook;
}

/// The names of the scripts of a workbook, for a message
function scriptNames(workbook: WorkbookScripts): string {
    return workbook.scriptOrder.map(scriptDisplayName).join(', ') || 'none';
}

/// A script of a workbook by the name that the agent gave it
function scriptOf(runtime: Runtime, workbook: WorkbookScripts, name: string): ScriptData {
    const fileName = scriptFileName(name);
    const ref = workbook.scriptRefs[fileName];
    const script = ref == null ? null : runtime.store.get('script', ref.scriptId);
    if (script == null) fail(`the workbook has no script ${scriptDisplayName(fileName)}, its scripts are ${scriptNames(workbook)}`);
    return script;
}

/// The connections that the agent may use, with their labels
function allowedConnections(host: AgentCommandHost): { connectionId: string; name: string; embedded?: true }[] {
    const { runtime } = host;
    return agentConnections(
        runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>,
        runtime.store.get('connectionList', 'root'),
        host.isConnectionAllowed,
    ).allowed.connections;
}

/// A connection in a line: its name, id, connector and whether it is set up
function connectionLine(host: AgentCommandHost, connection: { connectionId: string; name: string; embedded?: true }): string {
    const state = host.runtime.connection(connection.connectionId);
    const notes = [
        connection.embedded === true ? 'the embedded Hyper' : (state == null ? null : connectorInfoOf(state).names.displayShort),
        state?.connectionHealth === ConnectionHealth.ONLINE ? 'online' : 'not set up, the user has to connect it',
    ].filter(note => note != null && note.length > 0);
    return `${connection.name} (${connection.connectionId}): ${notes.join(', ')}`;
}

/// `scripts`: the workbook, the connections that the agent may use, the scripts with their connections, the attachments
function listScripts(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): number {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    const connections = allowedConnections(host);
    let out = `Workbook "${workbook.name ?? 'Untitled'}"\n`;
    out += connections.length === 0
        ? 'Connections: DashQL lets you use none, run runs no script. The user can allow them in the prompt.\n'
        : `Connections that you may use:\n${connections.map(connection => `  ${connectionLine(host, connection)}`).join('\n')}\n`;
    out += workbook.scriptOrder.length === 0 ? 'Scripts: none\n' : 'Scripts, in the order of the feed:\n';
    for (const fileName of workbook.scriptOrder) {
        const script = runtime.store.get('script', workbook.scriptRefs[fileName].scriptId);
        const text = script?.scriptSession.getText() ?? '';
        const lines = text.length === 0 ? 0 : text.split('\n').length;
        out += `  ${scriptDisplayName(fileName)}  ${plural(lines, 'line')}  on ${script?.connectionId ?? '?'}\n`;
    }
    const attachments = workbook.attachments ?? [];
    out += attachments.length === 0
        ? 'Attachments: none\n'
        : `Attachments, scripts on the embedded Hyper read them as :name:\n${attachments.map(attachment => `  :${attachment.name}  ${attachment.columns == null ? '' : attachment.columns.join(', ')}`.trimEnd()).join('\n')}\n`;
    reply.out(out);
    return EXIT_OK;
}

/// `read`: the text of a script
function readScript(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): number {
    const workbook = workbookOf(host.runtime, call.workbookId);
    const script = scriptOf(host.runtime, workbook, stringArg(call.args, 'script'));
    const text = script.scriptSession.getText();
    reply.out(text.endsWith('\n') || text.length === 0 ? text : `${text}\n`);
    return EXIT_OK;
}

/// The diagnostics of the analysis of a script, once its analysis is current
async function scriptDiagnostics(runtime: Runtime, workbookId: string, scriptKey: number): Promise<{ text: string; diagnostics: AgentDiagnostic[] }> {
    const current = runtime.store.get('script', scriptKey);
    if (current?.analysisOutdated === true) {
        await runtime.dispatch({ workbook: workbookId }, { kind: 'analyzeOutdatedScript', value: { scriptKey } }).settled;
    }
    const script = runtime.store.get('script', scriptKey);
    if (script == null) fail('the script is gone');
    const diagnostics = (script.editorUpdate?.diagnostics ?? []).map(diagnostic => ({
        severity: diagnostic.severity === core.buffers.editor.EditorDiagnosticSeverity.WARNING ? 'warning' as const : 'error' as const,
        source: core.buffers.editor.EditorDiagnosticSource[diagnostic.source]?.toLowerCase() ?? 'analyzer',
        message: typeof diagnostic.message === 'string' ? diagnostic.message : '',
        offset: diagnostic.textSpan == null ? null : Number(diagnostic.textSpan.offset),
        length: diagnostic.textSpan == null ? 0 : Number(diagnostic.textSpan.length),
    }));
    return { text: script.scriptSession.getText(), diagnostics };
}

/// `edit`: replace the text of a script, or create it, on a connection that the agent may name
async function editScript(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): Promise<number> {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    const fileName = scriptFileName(stringArg(call.args, 'script'));
    if (!/^[\w.-]+\.sql$/.test(fileName)) usage(`${fileName} is no script name: use letters, digits, - and _`);
    const connectionId = optionalString(call.args, 'connection');
    const text = call.input;
    if (text == null) usage('no text: pass the file of the text with --file or pipe it to stdin');
    if (connectionId != null) {
        const allowed = allowedConnections(host);
        if (!allowed.some(connection => connection.connectionId === connectionId)) {
            fail(`you may not use the connection ${connectionId}, the connections that you may use are ${allowed.map(connection => connection.connectionId).join(', ') || 'none'}`);
        }
    }
    const ref = workbook.scriptRefs[fileName];
    let scriptKey: number;
    let created = false;
    if (ref == null) {
        const before = new Set(Object.values(workbook.scriptRefs).map(r => r.scriptId));
        const outcome = runtime.dispatch({ workbook: call.workbookId }, {
            kind: 'createScript',
            value: { base: fileName.slice(0, -'.sql'.length), text, ...(connectionId != null ? { connectionId } : {}) },
        });
        if (!outcome.ok) fail(outcome.error ?? 'DashQL could not create the script');
        runtime.flush();
        const after = runtime.store.get('workbook', call.workbookId);
        const key = Object.values(after?.scriptRefs ?? {}).find(r => !before.has(r.scriptId))?.scriptId;
        if (key == null) fail('DashQL could not create the script');
        scriptKey = key;
        created = true;
    } else {
        scriptKey = ref.scriptId;
        const outcome = runtime.dispatch({ workbook: call.workbookId }, { kind: 'setScriptText', value: { scriptKey, text } });
        if (!outcome.ok) fail(outcome.error ?? 'DashQL could not change the script');
        if (connectionId != null && runtime.store.get('script', scriptKey)?.connectionId !== connectionId) {
            const moved = runtime.dispatch({ workbook: call.workbookId }, { kind: 'setScriptConnection', value: { fileName, connectionId } });
            if (!moved.ok) fail(moved.error ?? `DashQL could not move the script to ${connectionId}`);
        }
        runtime.flush();
    }
    // The workbook names a new script uniquely, its file name may differ from the one of the agent
    const name = Object.entries(runtime.store.get('workbook', call.workbookId)?.scriptRefs ?? {}).find(([, r]) => r.scriptId === scriptKey)?.[0] ?? fileName;
    host.onEdited(call.workbookId, name);
    host.onFollow(call.workbookId, scriptKey, 'script');
    const analyzed = await scriptDiagnostics(runtime, call.workbookId, scriptKey);
    const connection = runtime.store.get('script', scriptKey)?.connectionId ?? '?';
    let out = `${created ? 'Created' : 'Changed'} ${scriptDisplayName(name)} on ${connection}`;
    if (name !== fileName) out += `, DashQL named it ${scriptDisplayName(name)} because ${scriptDisplayName(fileName)} is taken: go on with that name`;
    reply.out(`${out}\n${diagnosticsText(scriptDisplayName(name), analyzed.text, analyzed.diagnostics)}`);
    return EXIT_OK;
}

/// `move`: move a script in the feed
function moveScript(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): number {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    const fileName = scriptOf(runtime, workbook, stringArg(call.args, 'script')).fileName;
    const before = optionalString(call.args, 'before');
    const after = optionalString(call.args, 'after');
    const first = call.args.first === true;
    const last = call.args.last === true;
    if ([before != null, after != null, first, last].filter(Boolean).length !== 1) usage('name one place: --before <script>, --after <script>, --first or --last');
    const order = workbook.scriptOrder.filter(name => name !== fileName);
    if (first) order.unshift(fileName);
    else if (last) order.push(fileName);
    else {
        const other = scriptOf(runtime, workbook, (before ?? after)!).fileName;
        if (other === fileName) usage('a script can not move next to itself');
        order.splice(order.indexOf(other) + (after != null ? 1 : 0), 0, fileName);
    }
    const outcome = runtime.dispatch({ workbook: call.workbookId }, { kind: 'reorderScripts', value: { order } });
    if (!outcome.ok) fail(outcome.error ?? 'DashQL could not move the script');
    runtime.flush();
    const moved = runtime.store.get('workbook', call.workbookId)?.scriptOrder ?? order;
    reply.out(`${moved.map(scriptDisplayName).join(', ')}\n`);
    return EXIT_OK;
}

/// The characters of the tables of a connection that `catalog` prints
const MAX_CATALOG_CHARS = 100_000;

/// `catalog`: the tables of the connections that the agent may use, as CREATE TABLE statements
function printCatalog(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): number {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    const wanted = optionalString(call.args, 'connection');
    const connections = allowedConnections(host);
    const shown = wanted == null ? connections : connections.filter(connection => connection.connectionId === wanted || connection.name.toLowerCase() === wanted.toLowerCase());
    if (shown.length === 0) {
        fail(wanted == null
            ? 'DashQL lets you use no connection, the user can allow them in the prompt'
            : `you may use no connection ${wanted}, the connections that you may use are ${connections.map(connection => `${connection.name} (${connection.connectionId})`).join(', ') || 'none'}`);
    }
    const sections = shown.map(connection => {
        const relations = (runtime.catalogRelationsFile(connection.connectionId) ?? '').trim();
        const tables = (relations.match(/^\s*create\s+table\b/gim) ?? []).length;
        const lines = [`-- ${connectionLine(host, connection)}, ${plural(tables, 'table')}`];
        if (relations.length === 0) lines.push('-- No tables known yet: DashQL learns the catalog of a connection once it is set up and ran a statement');
        else if (relations.length > MAX_CATALOG_CHARS) {
            const end = relations.lastIndexOf('\n', MAX_CATALOG_CHARS);
            lines.push(relations.slice(0, end > 0 ? end : MAX_CATALOG_CHARS), `-- Cut off after ${MAX_CATALOG_CHARS} characters, name the tables in a query of information_schema for the rest`);
        } else lines.push(relations);
        if (connection.embedded === true && (workbook.attachments ?? []).length > 0) {
            lines.push('-- Attachments, scripts on the embedded Hyper read them as :name');
            for (const attachment of workbook.attachments ?? []) lines.push(`--   :${attachment.name}${attachment.columns == null ? '' : `  ${attachment.columns.join(', ')}`}`);
        }
        return lines.join('\n');
    });
    reply.out(`${sections.join('\n\n')}\n`);
    return EXIT_OK;
}

/// `lint`: the diagnostics of a script
async function lintScript(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): Promise<number> {
    const workbook = workbookOf(host.runtime, call.workbookId);
    const script = scriptOf(host.runtime, workbook, stringArg(call.args, 'script'));
    const analyzed = await scriptDiagnostics(host.runtime, call.workbookId, script.scriptKey);
    reply.out(diagnosticsText(scriptDisplayName(script.fileName), analyzed.text, analyzed.diagnostics));
    return analyzed.diagnostics.some(diagnostic => diagnostic.severity === 'error') ? EXIT_FAILED : EXIT_OK;
}

/// `format`: format a script in the dialect of its connection
function formatScript(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): number {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    const script = scriptOf(runtime, workbook, stringArg(call.args, 'script'));
    const connectorType = runtime.connection(script.connectionId)?.connectorType as ConnectorType | undefined;
    const config = createScriptFormatConfig(core.buffers.formatting.FormattingMode.PRETTY, false, undefined, undefined, formattingDialectForConnector(connectorType));
    const text = script.scriptSession.getText();
    const formatted = formatSqlText(runtime.core, text, config);
    const name = scriptDisplayName(script.fileName);
    if (formatted == null) fail(`DashQL can not format all of ${name}, it stays as it is`);
    if (formatted === text) {
        reply.out(`${name} is formatted\n`);
        return EXIT_OK;
    }
    const outcome = runtime.dispatch({ workbook: call.workbookId }, { kind: 'setScriptText', value: { scriptKey: script.scriptKey, text: formatted } });
    if (!outcome.ok) fail(outcome.error ?? 'DashQL could not change the script');
    runtime.flush();
    host.onEdited(call.workbookId, script.fileName);
    host.onFollow(call.workbookId, script.scriptKey, 'script');
    reply.out(`Formatted ${name}, read it again before you edit it\n`);
    return EXIT_OK;
}

/// Run scripts of a workbook for the agent: the feed shows the run as any other, the events go to `emit` with the
/// first `rows` rows of every result. A run takes only the connections that the agent may use and that are set up.
async function runForAgent(host: AgentCommandHost, workbook: WorkbookScripts, scripts: readonly string[], refresh: boolean, rows: number, signal: AbortSignal, emit: (event: RunEvent) => void): Promise<void> {
    const { runtime } = host;
    try {
        await runWorkbookReported(runtime, workbook, {
            label: workbook.name ?? workbook.workbookId,
            scripts,
            refresh,
            signal,
            progressIntervalMs: null,
            // The feed shows the results of the run as those of its own runs, the rows come from their analyses
            analyze: true,
            rows,
            prepareConnection: async conn => {
                if (!host.isConnectionAllowed(conn.connectionId)) return 'DashQL does not let you use this connection, the user can allow it in the prompt';
                if (conn.connectionHealth !== ConnectionHealth.ONLINE) return 'the connection is not set up in DashQL, the user has to connect it';
                return null;
            },
            // The agent reads the whole result from its file
            resultFile: async script => {
                if (signal.aborted || host.results == null) return null;
                try {
                    return await runtime.withStoredResult(workbook.workbookId, script, async name => {
                        const data = new Uint8Array(await (await host.results!.readFile(workbook.workbookId, name)).arrayBuffer());
                        return await host.writeFile(workbook.workbookId, 'result', name, data);
                    });
                } catch (error) {
                    host.logger.warn('Cannot write the result of a script for the agent', { workbook: workbook.workbookId, script, error: stringifyError(error) }, LOG_CTX);
                    return null;
                }
            },
            onReportError: error => host.logger.warn('Cannot report a script of the run of the agent', { error: stringifyError(error) }, LOG_CTX),
        }, emit);
    } catch (error) {
        emit({ type: 'run_failed', error: describeRunError(error) });
        emit({ type: 'run_finished', ms: 0, ok: 0, failed: 0, cancelled: 0, notRun: 0, interrupted: signal.aborted });
    }
}

/// The scripts that a call names, every script without names; fails on names that the workbook doesn't have
function runScripts(runtime: Runtime, workbook: WorkbookScripts, names: readonly string[]): string[] {
    const files = names.map(scriptFileName);
    const { unknown } = runScriptsOf(runtime.core, workbook, files);
    if (unknown.length > 0) fail(`the workbook has no script ${unknown.map(scriptDisplayName).join(', ')}, its scripts are ${scriptNames(workbook)}`);
    return files;
}

/// Follow the agent to the scripts of a run while it runs
function followRun(host: AgentCommandHost, workbook: WorkbookScripts, event: RunEvent): void {
    if (event.type !== 'script_started' && event.type !== 'script_done' && event.type !== 'script_failed') return;
    const ref = workbook.scriptRefs[event.script];
    if (ref != null) host.onFollow(workbook.workbookId, ref.scriptId, 'result');
}

/// `run`: run scripts of the workbook, every script without names, and print their results
async function runCommand(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream, signal: AbortSignal): Promise<number> {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    const names = call.args.scripts ?? [];
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || name.length === 0)) usage('invalid scripts');
    const scripts = runScripts(runtime, workbook, names as string[]);
    const rows = integerArg(call.args, 'rows', DEFAULT_RUN_ROWS, 0, MAX_RUN_ROWS);
    const text = new RunText(reply.out, rows);
    let finished: Extract<RunEvent, { type: 'run_finished' }> | null = null;
    let failed = false;
    await runForAgent(host, workbook, scripts, call.args.refresh === true, rows, signal, event => {
        followRun(host, workbook, event);
        if (event.type === 'run_finished') finished = event;
        if (event.type === 'run_failed' || event.type === 'connection_failed') failed = true;
        text.event(event);
    });
    const end = finished as Extract<RunEvent, { type: 'run_finished' }> | null;
    if (end == null || failed || end.failed + end.cancelled + end.notRun > 0 || end.interrupted) return EXIT_FAILED;
    return EXIT_OK;
}

/// The chart of a script as the core compiles it: the renderer of the `@vis` tag of its last query and its spec
interface ScriptChart {
    renderer: 'vegalite' | 'markdown' | 'kpi' | 'table' | null;
    spec: Record<string, unknown> | null;
    /// The KPI card of `@vis kpi`
    kpi: core.buffers.visualization.KpiSpecT | null;
    /// The errors of compiling the script, e.g. a spec that is no JSON, and the warnings of the analyzer about the
    /// `@vis` tags. Columns and fields are checked against the result instead.
    errors: string[];
}

/// The warnings of the analyzer about the `@vis` tags of a script, but those about columns: the result has them all
function tagWarnings(script: core.DashQLScript): string[] {
    const analyzed = script.getAnalyzed().read();
    const warnings: string[] = [];
    for (let i = 0; i < analyzed.errorsLength(); ++i) {
        const error = analyzed.errors(i);
        if (error == null || error.errorType() !== core.buffers.analyzer.AnalyzerErrorType.INVALID_VIS_TAG) continue;
        const message = error.message() ?? '';
        if (!/^unknown (column|field) "/.test(message)) warnings.push(message);
    }
    return warnings;
}

/// Read the chart of a script with the core
export function scriptChart(dql: core.DashQL, text: string): ScriptChart {
    const catalog = dql.createCatalog();
    const script = dql.createScript(catalog);
    try {
        script.replaceText(text);
        script.analyze();
        const config = new core.buffers.formatting.FormattingConfigT(
            core.buffers.formatting.FormattingDialect.HYPER,
            core.buffers.formatting.FormattingMode.INLINE,
            120,
            2,
            false,
        );
        const compiled = script.compileQuery(config).unpack();
        const errors = compiled.errors.map((error: core.buffers.execution.ScriptCompilationErrorT) => String(error.message ?? ''));
        const visualization = compiled.visualization;
        const renderer = visualization?.renderer;
        if (renderer !== 'vegalite' && renderer !== 'markdown' && renderer !== 'kpi' && renderer !== 'table') return { renderer: null, spec: null, kpi: null, errors };
        errors.push(...tagWarnings(script));
        if (renderer === 'kpi') return { renderer, spec: null, kpi: visualization!.kpiSpec ?? null, errors };
        if (renderer !== 'vegalite') return { renderer, spec: null, kpi: null, errors };
        try {
            const spec = JSON.parse(String(visualization!.vegaliteSpec ?? ''));
            if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) return { renderer, spec: null, kpi: null, errors: [...errors, 'the Vega-Lite spec is no JSON object'] };
            // The core adds the schema and the query as data, the spec of the tag has neither
            const { $schema: _schema, data: _data, ...authored } = spec as Record<string, unknown>;
            return { renderer, spec: authored, kpi: null, errors };
        } catch (error) {
            return { renderer, spec: null, kpi: null, errors: [...errors, `the Vega-Lite spec is no valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
        }
    } finally {
        script.destroy();
        catalog.destroy();
    }
}

/// Render the chart of a script as the image download of the feed renders it: the `@vis vegalite` tag of its last
/// query with its result
async function renderChart(runtime: Runtime, workbookId: string, fileName: string, table: arrow.Table, size: { width: number; height: number; scale: number }) {
    const ref = runtime.store.get('workbook', workbookId)?.scriptRefs[fileName];
    const vis = ref == null ? null : runtime.store.get('script', ref.scriptId)?.annotations.visualizeQuery;
    if (vis?.renderer !== 'vegalite') throw new Error(`DashQL finds no @vis vegalite tag in ${scriptDisplayName(fileName)}`);
    return await renderVegaLitePng(vis.vegaLiteSpec, arrowTableToRows(table), size);
}

/// `vis`: check the chart of a script against its result and render it as PNG
async function visCommand(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream, signal: AbortSignal): Promise<number> {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    const script = scriptOf(runtime, workbook, stringArg(call.args, 'script'));
    const { fileName } = script;
    const name = scriptDisplayName(fileName);
    const size = {
        width: integerArg(call.args, 'width', CHART_IMAGE_WIDTH, 1, 4096),
        height: integerArg(call.args, 'height', CHART_IMAGE_HEIGHT, 1, 4096),
        scale: CHART_IMAGE_SCALE,
    };
    const tag = scriptChart(runtime.core, script.scriptSession.getText());
    const problems = [...tag.errors];
    if (tag.renderer == null) {
        reply.out(`${name} has no chart: add a @vis tag to the comment above its last query, see dashql guide\n${problems.map(problem => `  - ${problem}\n`).join('')}`);
        return EXIT_FAILED;
    }
    if (tag.spec != null) problems.push(...compileProblems(vegaLite.compile as unknown as VegaLiteCompile, tag.spec));

    // The result of the script is the data of the chart
    let done: Extract<RunEvent, { type: 'script_done' }> | null = null;
    const failures: string[] = [];
    // The rows that a KPI card is checked with, a result with more is not checked
    await runForAgent(host, workbook, [fileName], call.args.refresh === true, KPI_CHECK_ROWS, signal, event => {
        followRun(host, workbook, event);
        switch (event.type) {
            case 'script_done':
                if (event.script === fileName) done = event;
                break;
            case 'script_failed':
                failures.push(`${scriptDisplayName(event.script)} failed: ${event.error}`);
                break;
            case 'script_not_run':
                failures.push(`${scriptDisplayName(event.script)} did not run: ${event.reason}`);
                break;
            case 'connection_failed':
                failures.push(`the connection ${event.connection} failed: ${event.error}`);
                break;
            case 'run_failed':
                failures.push(`the run failed: ${event.error}`);
                break;
        }
    });
    if (signal.aborted) return EXIT_FAILED;
    const result = done as Extract<RunEvent, { type: 'script_done' }> | null;
    const table = result?.table ?? null;
    const columns = table?.schema.fields.map(field => field.name) ?? null;
    if (tag.spec != null) problems.push(...chartSpecProblems(tag.spec, columns));
    const resultRows = result?.rows ?? null;
    let out = `${name}: @vis ${tag.renderer}${resultRows == null ? ', no result' : `, ${plural(resultRows, 'row')}`}${columns == null ? '' : `, columns ${columns.join(', ') || 'none'}`}\n`;
    for (const failure of failures) out += `  ${failure}\n`;
    if (result == null) problems.push('the script has no result, the chart is not rendered');

    // A KPI card is checked with the rows of the result
    if (tag.kpi != null && table != null && resultRows != null) {
        if (resultRows > KPI_CHECK_ROWS || resultRows > table.numRows) {
            problems.push(`the result has ${resultRows} rows, more than the ${KPI_CHECK_ROWS} that a KPI card is checked with: aggregate the query, e.g. by day or week`);
        } else {
            const reading = readKpi(table, tag.kpi);
            if (reading.missing == null) out += `  KPI card: ${describeKpi(reading, tag.kpi)}\n`;
            problems.push(...kpiProblems(reading, columns ?? []));
        }
    }

    // The PNG of a Vega-Lite chart, as the feed renders it. The chart takes every row of the result from the history of
    // the query until charts read what they draw (docs/wip/result_windows.md, step 5).
    let wrote: string | null = null;
    const chartTable = result?.queryId == null ? undefined : runtime.table(runtime.store.get('query', result.queryId)?.resultTable?.id);
    if (tag.spec != null && chartTable != null) {
        try {
            const image = await renderChart(runtime, call.workbookId, fileName, chartTable, size);
            const path = await host.writeFile(call.workbookId, 'chart', `${name}.png`, image.png);
            wrote = `${path} (${image.width}x${image.height} pixels)`;
        } catch (error) {
            problems.push(`DashQL did not render the chart: ${error instanceof Error ? error.message : stringifyError(error)}`);
        }
    }
    out += problems.length > 0 ? `Problems:\n${problems.map(problem => `  - ${problem}\n`).join('')}` : 'No problems.\n';
    if (wrote != null) out += `Wrote ${wrote}, look at it to check the chart\n`;
    reply.out(out);
    return problems.length > 0 ? EXIT_FAILED : EXIT_OK;
}

/// The name of a script that a call names, as the feed shows it, null without one
function namedScript(args: Record<string, unknown>, name: string): string | null {
    const value = args[name];
    return typeof value === 'string' && value.length > 0 ? scriptDisplayName(scriptFileName(value)) : null;
}

/// What a call does, in one line for the steps of the turn: the page tells the `dashql` commands of the agent better
/// than the shell command that ran them
export function describeAgentCall(call: Pick<AgentCall, 'command' | 'args'>): string {
    const script = namedScript(call.args, 'script') ?? 'a script';
    switch (call.command) {
        case 'scripts':
            return 'List the scripts';
        case 'read':
            return `Read ${script}`;
        case 'edit':
            return `Write ${script}`;
        case 'move':
            return `Move ${script}`;
        case 'catalog': {
            const connection = typeof call.args.connection === 'string' && call.args.connection.length > 0 ? call.args.connection : null;
            return connection == null ? 'Look up the tables' : `Look up the tables of ${connection}`;
        }
        case 'lint':
            return `Check ${script}`;
        case 'format':
            return `Format ${script}`;
        case 'run': {
            const names = Array.isArray(call.args.scripts) ? call.args.scripts.filter((name): name is string => typeof name === 'string' && name.length > 0) : [];
            return names.length === 0 ? 'Run all scripts' : `Run ${names.map(name => scriptDisplayName(scriptFileName(name))).join(', ')}`;
        }
        case 'vis':
            return `Check the chart of ${script}`;
        default:
            return `dashql ${call.command}`;
    }
}

/// Answer a call of the agent: the text goes to `reply`, resolves with the exit code. A command that fails says why on
/// stderr.
export async function runAgentCommand(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream, signal: AbortSignal): Promise<number> {
    try {
        switch (call.command) {
            case 'scripts':
                return listScripts(host, call, reply);
            case 'read':
                return readScript(host, call, reply);
            case 'edit':
                return await editScript(host, call, reply);
            case 'move':
                return moveScript(host, call, reply);
            case 'catalog':
                return printCatalog(host, call, reply);
            case 'lint':
                return await lintScript(host, call, reply);
            case 'format':
                return formatScript(host, call, reply);
            case 'run':
                return await runCommand(host, call, reply, signal);
            case 'vis':
                return await visCommand(host, call, reply, signal);
            default:
                return usage(`DashQL knows no command ${call.command}, update the app`);
        }
    } catch (error) {
        if (error instanceof CommandError) {
            reply.err(`error: ${error.message}\n`);
            return error.code;
        }
        host.logger.error('A command of the agent failed', { command: call.command, error: stringifyError(error) }, LOG_CTX);
        reply.err(`error: ${error instanceof Error ? error.message : stringifyError(error)}\n`);
        return EXIT_FAILED;
    }
}
