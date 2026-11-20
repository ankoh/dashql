// dashql vis: checks the chart of a script, its `@vis` tag, against the result of the script and renders it as PNG
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import * as vegaLite from 'vega-lite';

import * as core from '@akohn/dashql';
import {
    CHART_IMAGE_HEIGHT,
    CHART_IMAGE_SCALE,
    CHART_IMAGE_WIDTH,
    chartSpecProblems,
    compileProblems,
    type VegaLiteCompile,
} from '@akohn/dashql/platform/workbook/chart_config';
import { SESSION_JOURNAL_FOLDER } from '@akohn/dashql/platform/session/workbook_journal';
import { STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE } from '@akohn/dashql/platform/storage/storage_backend';
import type { RunEvent } from '@akohn/dashql/platform/workbook/run_events';

import { EXIT_FAILED, EXIT_INTERRUPTED, EXIT_OK, EXIT_USAGE, type CliProcess } from './cli_process.js';
import { processRunEnvironment, runWorkbookFolder, type RunEnvironment } from './run_command.js';
import { commandSession } from './session_journal.js';

export const VIS_USAGE = `Usage: dashql vis [--out <file.png>] [--width <n>] [--height <n>] [--scale <n>] [--refresh]
                 [--workspace <dir> --session <id>] <workbook-dir> <script>

Checks the chart of a script and renders it as PNG to look at. The chart is the @vis tag in the comment above the
last query of the script, the result of the script is its data. vis runs the script like dashql run, a result that is
cached is not run again. It prints the renderer, the columns and the rows of the result, and what is wrong with a
Vega-Lite chart: errors and warnings of Vega-Lite, fields that are no columns of the result, sizes that DashQL decides.

The tab of DashQL renders the PNG with the result, as it runs the script: for a workbook that it copied into a
session of dashql connect, which --workspace and --session name. It has the theme of DashQL, ${CHART_IMAGE_WIDTH}x${CHART_IMAGE_HEIGHT} at scale ${CHART_IMAGE_SCALE} unless given otherwise.
Check a narrow card too, e.g. --width 400 --height 400: the cards of the feed, the dashboard and the dataflow differ in
aspect ratio. The file is charts/<script>.png in the .dashql/ of the workspace unless --out names it. Other workbook
folders get the check only.

Exits with 0 when the chart has no problems, 1 when it has some or the script has no chart or no result, 2 on usage
errors.`;

interface VisArgs {
    workbook: string;
    script: string;
    out: string | null;
    width: number;
    height: number;
    scale: number;
    refresh: boolean;
    workspace: string | null;
    session: string | null;
}

/// Parse the arguments, an error message if they are invalid
function parseVisArgs(args: string[]): VisArgs | string {
    const out: Omit<VisArgs, 'workbook' | 'script'> = {
        out: null,
        width: CHART_IMAGE_WIDTH,
        height: CHART_IMAGE_HEIGHT,
        scale: CHART_IMAGE_SCALE,
        refresh: false,
        workspace: null,
        session: null,
    };
    const positional: string[] = [];
    const number = (name: string, value: string | undefined, max: number): number | string => {
        const parsed = Number(value);
        return value != null && /^\d+(\.\d+)?$/.test(value) && parsed > 0 && parsed <= max ? parsed : `${name} takes a number up to ${max}`;
    };
    for (let i = 0; i < args.length; ++i) {
        const arg = args[i];
        const take = (name: 'width' | 'height' | 'scale', max: number): string | null => {
            const value = number(`--${name}`, args[++i], max);
            if (typeof value === 'string') return value;
            out[name] = name === 'scale' ? value : Math.floor(value);
            return null;
        };
        let error: string | null = null;
        if (arg === '--out') {
            const value = args[++i];
            if (value == null || value.startsWith('-')) return '--out takes a file';
            out.out = value;
        } else if (arg === '--workspace') {
            const value = args[++i];
            if (value == null || value.startsWith('-')) return '--workspace takes a folder';
            out.workspace = value;
        } else if (arg === '--session') {
            const value = args[++i];
            if (value == null || value.startsWith('-')) return '--session takes the id of the session';
            out.session = value;
        } else if (arg === '--width') {
            error = take('width', 4096);
        } else if (arg === '--height') {
            error = take('height', 4096);
        } else if (arg === '--scale') {
            error = take('scale', 4);
        } else if (arg === '--refresh') {
            out.refresh = true;
        } else if (arg.startsWith('-')) {
            return `unknown option ${arg}`;
        } else {
            positional.push(arg);
        }
        if (error != null) return error;
    }
    if (positional.length !== 2) return positional.length < 2 ? 'missing the workbook folder or the script' : `unexpected argument ${positional[2]}`;
    return { workbook: positional[0], script: positional[1], ...out };
}

/// The chart of a script as the core compiles it: the renderer of the `@vis` tag of its last query and its spec
interface ScriptChart {
    renderer: 'vegalite' | 'markdown' | 'table' | null;
    spec: Record<string, unknown> | null;
    /// The errors of compiling the script, e.g. a spec that is no JSON
    errors: string[];
}

/// The formatting of the compiled query, only the chart matters here
function compileConfig(): core.buffers.formatting.FormattingConfigT {
    return new core.buffers.formatting.FormattingConfigT(
        core.buffers.formatting.FormattingDialect.HYPER,
        core.buffers.formatting.FormattingMode.INLINE,
        120,
        2,
        false,
    );
}

/// Read the chart of a script with the core
export function scriptChart(dql: core.DashQL, text: string): ScriptChart {
    const catalog = dql.createCatalog();
    const script = dql.createScript(catalog);
    try {
        script.replaceText(text);
        script.analyze();
        const compiled = script.compileQuery(compileConfig()).unpack();
        const errors = compiled.errors.map((error: core.buffers.execution.ScriptCompilationErrorT) => String(error.message ?? ''));
        const visualization = compiled.visualization;
        const renderer = visualization?.renderer;
        if (renderer !== 'vegalite' && renderer !== 'markdown' && renderer !== 'table') return { renderer: null, spec: null, errors };
        if (renderer !== 'vegalite') return { renderer, spec: null, errors };
        try {
            const spec = JSON.parse(String(visualization!.vegaliteSpec ?? ''));
            if (spec == null || typeof spec !== 'object' || Array.isArray(spec)) return { renderer, spec: null, errors: [...errors, 'the Vega-Lite spec is no JSON object'] };
            // The core adds the schema and the query as data, the spec of the tag has neither
            const { $schema: _schema, data: _data, ...authored } = spec as Record<string, unknown>;
            return { renderer, spec: authored, errors };
        } catch (error) {
            return { renderer, spec: null, errors: [...errors, `the Vega-Lite spec is no valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
        }
    } finally {
        script.destroy();
        catalog.destroy();
    }
}

/// The file name of a script that the user named: `orders`, `orders.sql` or `scripts/orders.sql`
function scriptFileName(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? name;
    return base.endsWith('.sql') ? base : `${base}.sql`;
}

/// The root of the files of DashQL of a workspace: its `.dashql/`, else `~/.dashql`
function dashqlRootOf(workspace: string): string {
    const root = path.join(workspace, SESSION_JOURNAL_FOLDER);
    return existsSync(root) ? root : path.join(homedir(), SESSION_JOURNAL_FOLDER);
}

/// Run `dashql vis` with its arguments, returns the exit code
export async function runVis(args: string[], cli: CliProcess, env: RunEnvironment = processRunEnvironment()): Promise<number> {
    if (args.includes('-h') || args.includes('--help')) {
        cli.stdout(`${VIS_USAGE}\n`);
        return EXIT_OK;
    }
    const parsed = parseVisArgs(args);
    if (typeof parsed === 'string') {
        cli.stderr(`error: ${parsed}\n\n${VIS_USAGE}\n`);
        return EXIT_USAGE;
    }
    const dir = path.resolve(cli.cwd, parsed.workbook);
    const session = commandSession(cli.cwd, parsed.workspace, parsed.session, parsed.workbook);
    if (typeof session === 'string') {
        cli.stderr(`error: ${session}\n`);
        return EXIT_USAGE;
    }
    const { workspace } = session;
    if (!existsSync(path.join(dir, STORAGE_WORKBOOK_FILE))) {
        cli.stderr(`error: ${parsed.workbook} is no workbook folder, it has no ${STORAGE_WORKBOOK_FILE}\n`);
        return EXIT_USAGE;
    }
    const fileName = scriptFileName(parsed.script);
    const name = fileName.slice(0, -'.sql'.length);
    let text: string;
    try {
        text = readFileSync(path.join(dir, STORAGE_SCRIPTS_FOLDER, fileName), 'utf8');
    } catch {
        cli.stderr(`error: the workbook has no script ${STORAGE_SCRIPTS_FOLDER}/${fileName}\n`);
        return EXIT_USAGE;
    }

    const tag = scriptChart(await cli.setupCore(), text);
    const problems = [...tag.errors];
    if (tag.renderer == null) {
        cli.stdout(`${fileName} has no chart: add a @vis tag to the comment above its last query, see dashql describe\n`);
        for (const problem of problems) cli.stdout(`  - ${problem}\n`);
        return EXIT_FAILED;
    }
    if (tag.spec != null) problems.push(...compileProblems(vegaLite.compile as unknown as VegaLiteCompile, tag.spec));

    // The result of the script is the data of the chart
    const stop = new AbortController();
    const interrupt = () => stop.abort();
    if (cli.interrupt?.aborted) interrupt();
    else cli.interrupt?.addEventListener('abort', interrupt, { once: true });
    let done: Extract<RunEvent, { type: 'script_done' }> | null = null;
    let image: Extract<RunEvent, { type: 'script_chart' }> | null = null;
    const failures: string[] = [];
    let code: number;
    // The columns of the result are enough here, the tab renders the chart with all of it
    const run = { workbook: parsed.workbook, scripts: [fileName], rows: 0, refresh: parsed.refresh, verbose: false };
    // The tab renders the PNG of a Vega-Lite chart after the result
    const chartSize = tag.spec == null ? null : { width: parsed.width, height: parsed.height, scale: parsed.scale };
    try {
        code = await runWorkbookFolder({ ...run, chart: chartSize }, dir, session, env, cli, stop.signal, event => {
            switch (event.type) {
                case 'script_done':
                    if (event.script === fileName) done = event;
                    break;
                case 'script_chart':
                    if (event.script === fileName) image = event;
                    break;
                case 'script_failed':
                    failures.push(`${event.script} failed: ${event.error}`);
                    break;
                case 'script_not_run':
                    failures.push(`${event.script} did not run: ${event.reason}`);
                    break;
                case 'connection_failed':
                    failures.push(`the connection ${event.connection} failed: ${event.error}`);
                    break;
                case 'run_failed':
                    failures.push(`the run failed: ${event.error}`);
                    break;
            }
        });
    } finally {
        cli.interrupt?.removeEventListener('abort', interrupt);
    }
    if (code === EXIT_INTERRUPTED) return code;
    const result = done as Extract<RunEvent, { type: 'script_done' }> | null;
    const table = result?.table ?? null;
    const columns = table?.schema.fields.map(field => field.name) ?? null;
    if (tag.spec != null) problems.push(...chartSpecProblems(tag.spec, columns));

    const rows = result?.rows ?? null;
    cli.stdout(`${fileName}: @vis ${tag.renderer}${rows == null ? ', no result' : `, ${rows} row${rows === 1 ? '' : 's'}`}${columns == null ? '' : `, columns ${columns.join(', ') || 'none'}`}\n`);
    for (const failure of failures) cli.stdout(`  ${failure}\n`);
    if (result == null) problems.push('the script has no result, the chart is not rendered');

    // The PNG of the tab
    const rendered = image as Extract<RunEvent, { type: 'script_chart' }> | null;
    let wrote: string | null = null;
    if (rendered?.png != null) {
        const out = parsed.out != null ? path.resolve(cli.cwd, parsed.out) : path.join(dashqlRootOf(workspace), 'charts', `${name}.png`);
        mkdirSync(path.dirname(out), { recursive: true });
        writeFileSync(out, rendered.png);
        wrote = `${path.relative(cli.cwd, out) || out} (${rendered.width}x${rendered.height} pixels)`;
    } else if (rendered?.error != null) {
        problems.push(`the tab of DashQL did not render the chart: ${rendered.error}`);
    }
    if (problems.length > 0) {
        cli.stdout('Problems:\n');
        for (const problem of problems) cli.stdout(`  - ${problem}\n`);
    } else {
        cli.stdout('No problems.\n');
    }
    if (wrote != null) cli.stdout(`Wrote ${wrote}, look at it to check the chart\n`);
    else if (tag.spec != null && result != null && rendered == null) {
        cli.stdout('No PNG: the tab of DashQL renders it, for a workbook that it copied into a session of dashql connect\n');
    }
    return problems.length > 0 ? EXIT_FAILED : EXIT_OK;
}
