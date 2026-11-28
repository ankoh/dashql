// The `dashql` commands of an agent, answered by the page on the workbook that it shows (docs/design/agent_integration.md):
// the main process of the desktop app passes every call of the command line tool to the page, the page changes and runs
// the live workbook and answers with text and an exit code
import * as vegaLite from 'vega-lite';
import * as core from '@akohn/dashql';

import { ConnectionHealth, connectorInfoOf, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { CHART_IMAGE_HEIGHT, CHART_IMAGE_SCALE, CHART_IMAGE_WIDTH, chartSpecProblems, compileProblems, type VegaLiteCompile } from '@akohn/dashql/platform/workbook/chart_config';
import { KPI_CARD_ROWS, kpiProblems, readKpi } from '@akohn/dashql/platform/workbook/kpi_reading';
import type { RunEvent } from '@akohn/dashql/platform/workbook/run_events';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import type { ScriptData, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { WorkbookResultFiles } from '@akohn/dashql/platform/workbook/workbook_result_files';
import { stringifyError, type Logger } from '@akohn/dashql/platform/logger/logger';
import { describeRunError, runScriptsOf, runWorkbookReported } from '@akohn/dashql/runtime/workbook_run_report';
import type { Runtime } from '@akohn/dashql/runtime/runtime';

import { renderVegaLitePng } from '@akohn/dashql-react/vegalite/vegalite_image';
import { arrowTableToRows, CHART_ROWS } from '@akohn/dashql-react/vegalite/vegalite_rows';

import { createScriptFormatConfig, formatSqlText, formattingDialectForConnector } from '../workbook/scripts/script_format.js';
import { agentConnections, type AgentConnection } from './agent_connections.js';
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
    /// May the agent use a connection on a workbook?
    isConnectionAllowed: (workbook: WorkbookScripts, connectionId: string) => boolean;
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
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) usage(`--${name} takes a number from ${min} to ${max}`);
    return value;
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

/// A script of a workbook by the name that the agent gave it, `orders`, `Orders.sql` or `scripts/orders.sql`: the core
/// resolves the name as it does for `run`
function scriptOf(runtime: Runtime, workbook: WorkbookScripts, name: string): ScriptData {
    const { selected, unknown } = runScriptsOf(runtime.core, workbook, [name]);
    const ref = selected.length === 0 ? null : workbook.scriptRefs[selected[0]];
    const script = ref == null ? null : runtime.store.get('script', ref.scriptId);
    if (script == null) fail(`the workbook has no script ${unknown[0] ?? name}, its scripts are ${scriptNames(workbook)}`);
    return script;
}

/// The connections that the agent may use on a workbook, with their labels
function allowedConnections(host: AgentCommandHost, workbook: WorkbookScripts): AgentConnection[] {
    const { runtime } = host;
    return agentConnections(
        runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>,
        runtime.store.get('connectionList', 'root'),
        connectionId => host.isConnectionAllowed(workbook, connectionId),
    ).allowed;
}

/// A connection in a line: its name, id, connector and whether it is set up
function connectionLine(host: AgentCommandHost, connection: AgentConnection): string {
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
    const connections = allowedConnections(host, workbook);
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
async function scriptDiagnostics(runtime: Runtime, workbookId: string, scriptKey: number): Promise<{ script: ScriptData; text: string; diagnostics: AgentDiagnostic[] }> {
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
    return { script, text: script.scriptSession.getText(), diagnostics };
}

/// `edit`: replace the text of a script, or create it, on a connection that the agent may name
async function editScript(host: AgentCommandHost, call: AgentCall, reply: AgentReplyStream): Promise<number> {
    const { runtime } = host;
    const workbook = workbookOf(runtime, call.workbookId);
    // The script of the name as `scriptOf` finds it, or the name of a new script
    const { selected, unknown } = runScriptsOf(runtime.core, workbook, [stringArg(call.args, 'script')]);
    const ref = selected.length === 0 ? null : workbook.scriptRefs[selected[0]];
    const base = unknown[0] ?? '';
    if (ref == null && base.length === 0) usage('missing script');
    const connectionId = optionalString(call.args, 'connection');
    const text = call.input;
    if (text == null) usage('no text: pass the file of the text with --file or pipe it to stdin');
    if (connectionId != null) {
        const allowed = allowedConnections(host, workbook);
        if (!allowed.some(connection => connection.connectionId === connectionId)) {
            fail(`you may not use the connection ${connectionId}, the connections that you may use are ${allowed.map(connection => connection.connectionId).join(', ') || 'none'}`);
        }
    }
    let scriptKey: number;
    let created = false;
    if (ref == null) {
        const outcome = runtime.dispatch({ workbook: call.workbookId }, {
            kind: 'createScript',
            value: { base, text, ...(connectionId != null ? { connectionId } : {}) },
        });
        if (!outcome.ok || typeof outcome.id !== 'number') fail(outcome.error ?? 'DashQL could not create the script');
        runtime.flush();
        scriptKey = outcome.id;
        created = true;
    } else {
        scriptKey = ref.scriptId;
        const outcome = runtime.dispatch({ workbook: call.workbookId }, { kind: 'setScriptText', value: { scriptKey, text } });
        if (!outcome.ok) fail(outcome.error ?? 'DashQL could not change the script');
        if (connectionId != null && runtime.store.get('script', scriptKey)?.connectionId !== connectionId) {
            const moved = runtime.dispatch({ workbook: call.workbookId }, { kind: 'setScriptConnection', value: { fileName: ref.fileName, connectionId } });
            if (!moved.ok) fail(moved.error ?? `DashQL could not move the script to ${connectionId}`);
        }
        runtime.flush();
    }
    // The workbook names a new script uniquely, its name may differ from the one of the agent
    const name = Object.entries(runtime.store.get('workbook', call.workbookId)?.scriptRefs ?? {}).find(([, r]) => r.scriptId === scriptKey)?.[0] ?? ref?.fileName ?? base;
    host.onEdited(call.workbookId, name);
    host.onFollow(call.workbookId, scriptKey, 'script');
    const analyzed = await scriptDiagnostics(runtime, call.workbookId, scriptKey);
    const connection = runtime.store.get('script', scriptKey)?.connectionId ?? '?';
    let out = `${created ? 'Created' : 'Changed'} ${scriptDisplayName(name)} on ${connection}`;
    if (created && scriptDisplayName(name) !== base) out += `, DashQL named it ${scriptDisplayName(name)} because ${base} is taken: go on with that name`;
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
    const connections = allowedConnections(host, workbook);
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
            scripts,
            refresh,
            signal,
            rows,
            prepareConnection: async conn => {
                if (!host.isConnectionAllowed(workbook, conn.connectionId)) return 'DashQL does not let you use this connection, the user can allow it in the prompt';
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
    const { selected, unknown } = runScriptsOf(runtime.core, workbook, names);
    if (unknown.length > 0) fail(`the workbook has no script ${unknown.join(', ')}, its scripts are ${scriptNames(workbook)}`);
    return names.length === 0 ? [] : selected;
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

/// The problems of the `@vis` tags of a script: the diagnostics of its analysis that point into the tags
function visTagProblems(script: ScriptData, diagnostics: readonly AgentDiagnostic[]): string[] {
    const tags = (script.editorUpdate?.commentTags ?? []).flatMap(tag => tag.name === 'vis' && tag.textSpan != null
        ? [{ from: Number(tag.textSpan.offset), to: Number(tag.textSpan.offset + tag.textSpan.length) }]
        : []);
    return diagnostics
        .filter(diagnostic => diagnostic.offset != null && tags.some(tag => diagnostic.offset! >= tag.from && diagnostic.offset! < tag.to))
        .map(diagnostic => diagnostic.message);
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
    // The chart as the page analyzed it, with the problems of its tags, e.g. a spec that is no JSON
    const analyzed = await scriptDiagnostics(runtime, call.workbookId, script.scriptKey);
    const vis = analyzed.script.annotations.visualizeQuery;
    const problems = visTagProblems(analyzed.script, analyzed.diagnostics);
    if (vis == null) {
        reply.out(`${name} has no chart: add a @vis tag to the comment above its last query, see dashql guide\n${problems.map(problem => `  - ${problem}\n`).join('')}`);
        return EXIT_FAILED;
    }
    // The core adds the schema and the query as data, the spec of the tag has neither
    const { $schema: _schema, data: _data, ...spec } = vis.renderer === 'vegalite' ? vis.vegaLiteSpec as unknown as Record<string, unknown> : {};
    const tag = {
        renderer: vis.renderer,
        spec: vis.renderer === 'vegalite' ? spec : null,
        kpi: vis.renderer === 'kpi' ? vis.kpiSpec : null,
    };
    if (tag.spec != null) problems.push(...compileProblems(vegaLite.compile as unknown as VegaLiteCompile, tag.spec));

    // The result of the script is the data of the chart
    let done: Extract<RunEvent, { type: 'script_done' }> | null = null;
    const failures: string[] = [];
    // The run reads the rows that the view reads: the first rows that a chart draws, the rows of a KPI card
    const rows = tag.spec != null ? CHART_ROWS : KPI_CARD_ROWS;
    await runForAgent(host, workbook, [fileName], call.args.refresh === true, rows, signal, event => {
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
        if (resultRows > table.numRows) {
            problems.push(`⚠ the result has ${resultRows} rows, the KPI card reads only the last ${KPI_CARD_ROWS}: aggregate the query, e.g. by day or week`);
        } else {
            const reading = readKpi(table, tag.kpi);
            if (reading.missing == null) out += `  KPI card: ${describeKpi(reading, tag.kpi)}\n`;
            problems.push(...kpiProblems(reading, columns ?? []));
        }
    }

    // The PNG of a Vega-Lite chart, as the image download of the feed renders it: the spec that was checked above with
    // the first rows of the result that the run read, at most as many as a chart draws
    let wrote: string | null = null;
    if (vis.renderer === 'vegalite' && result != null && resultRows != null) {
        if (resultRows > CHART_ROWS) {
            problems.push(`⚠ the result has ${resultRows} rows, the chart draws only the first ${CHART_ROWS} and warns about the others: aggregate the query, e.g. by day or week`);
        }
        try {
            if (table == null) throw new Error('the result has no rows to draw');
            const image = await renderVegaLitePng(vis.vegaLiteSpec, arrowTableToRows(table), size);
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

/// A name of a script in the line of a call, `scripts/orders.sql` is `orders`
function scriptLabel(name: string): string {
    return scriptDisplayName(name.trim().split(/[\\/]/).pop() ?? name);
}

/// The name of a script that a call names, as the feed shows it, null without one
function namedScript(args: Record<string, unknown>, name: string): string | null {
    const value = args[name];
    return typeof value === 'string' && value.length > 0 ? scriptLabel(value) : null;
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
            return names.length === 0 ? 'Run all scripts' : `Run ${names.map(scriptLabel).join(', ')}`;
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
