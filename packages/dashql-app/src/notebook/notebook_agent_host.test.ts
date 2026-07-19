import * as core from '../core/index.js';

import { startAgentRun, AgentAIClient } from '../agent/agent_run_driver.js';
import {
    AgentRunAction,
    AgentRunPhase,
    AgentRunState,
    reduceAgentRun,
} from '../agent/agent_run_state.js';
import { createNotebookAgentHost, chooseApplyAction } from './notebook_agent_host.js';
import {
    NotebookState,
    NotebookStateAction,
    SET_SCRIPT_TEXT,
    CREATE_NOTEBOOK_ENTRY_WITH_TEXT,
    REGISTER_AGENT_RUN,
    createEmptyScriptData,
    reduceNotebookState,
    analyzeAllScriptsInNotebook,
} from './notebook_state.js';
import { createDatalessConnectorInfo } from '../connection/connector_info.js';
import { StorageWriter, StorageWriteTaskVariant } from '../platform/storage/storage_writer.js';
import { Logger } from '../platform/logger/logger.js';
import { createEmptyMetadata, createPageScript, generateScriptFileName } from './notebook_types.js';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}
class NullStorageBackend {
    async listSessions(): Promise<string[]> { return []; }
    async loadSession(): Promise<any> { return {}; }
    async saveSessionManifest(): Promise<void> { }
    async deleteSession(): Promise<void> { }
    async loadSessionSchema(): Promise<string | null> { return null; }
    async saveSessionSchema(): Promise<void> { }
    async loadSessionFunctions(): Promise<string | null> { return null; }
    async saveSessionFunctions(): Promise<void> { }
    async loadNotebookPages(): Promise<any[]> { return []; }
    async createNotebookPage(): Promise<void> { }
    async deleteNotebookPage(): Promise<void> { }
    async renameNotebookPage(): Promise<void> { }
    async reorderNotebookPage(): Promise<void> { }
    async loadNotebookScript(): Promise<any> { return {}; }
    async saveNotebookScript(): Promise<void> { }
    async deleteNotebookScript(): Promise<void> { }
    async renameNotebookScript(): Promise<void> { }
    async loadNotebookScriptDraft(): Promise<string | null> { return null; }
    async saveNotebookScriptDraft(): Promise<void> { }
}
class NullStorageWriter extends StorageWriter {
    public override async write(_key: string, _task: StorageWriteTaskVariant, _debounce?: number): Promise<boolean> {
        return true;
    }
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
const logger = new NullLogger();
const backend = new NullStorageBackend() as any;
const storage = new NullStorageWriter(logger, backend);

beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(() => {
    dql!.resetUnsafe();
});

const MAIN_FOLDER = 'Main';

/// A mock AI client that returns canned completions in order. The classify call is matched
/// by prompt content; generation calls are drained from the queue.
class MockAIClient implements AgentAIClient {
    classifyReply: string;
    completions: string[];
    prompts: string[] = [];
    constructor(classifyReply: string, completions: string[]) {
        this.classifyReply = classifyReply;
        this.completions = [...completions];
    }
    async generate(prompt: string, _signal: AbortSignal): Promise<string> {
        this.prompts.push(prompt);
        if (/exactly one lowercase word/.test(prompt)) {
            return this.classifyReply;
        }
        return this.completions.shift() ?? '';
    }
}

/// Build a notebook whose single focused script references a `sales` table that lives in the
/// catalog, so generated candidates can resolve columns. Returns a mutable holder so the
/// driver's modifyNotebook can update the state and getNotebook sees the latest.
function buildNotebook(focusedSql: string): { state: NotebookState; focusedKey: number } {
    const catalog = dql!.createCatalog();
    const registry = dql!.createScriptRegistry();

    // Seed the catalog with a `sales` table via a schema script.
    const schemaScript = dql!.createScript(catalog);
    schemaScript.replaceText('create table sales(category text, amount int, ts timestamp);');
    schemaScript.analyze();
    catalog.loadScript(schemaScript, 0);

    const [committedKey, committedData] = createEmptyScriptData(dql!, catalog);
    const file = generateScriptFileName({});
    committedData.script.replaceText(focusedSql);

    const sessionId = 'test-session';
    let state: NotebookState = {
        instance: dql!,
        sessionId,
        notebookMetadata: createEmptyMetadata(),
        connectorInfo: createDatalessConnectorInfo(true),
        connectionCatalog: catalog,
        scriptRegistry: registry,
        scripts: {
            [committedKey]: { ...committedData, folderName: MAIN_FOLDER, fileName: file },
        },
        notebookPages: {
            [MAIN_FOLDER]: {
                folderName: MAIN_FOLDER,
                scripts: { [file]: createPageScript(committedKey, file) },
            },
        },
        uncommittedScriptId: 0,
        notebookUserFocus: { folderName: MAIN_FOLDER, fileName: file, interactionCounter: 0 },
        semanticUserFocus: null,
    };
    // Analyze so annotations (incl. visualizeQuery) and references are populated.
    state = analyzeAllScriptsInNotebook(state, logger);
    return { state, focusedKey: committedKey };
}

/// Drive a run to completion through the notebook agent host, collecting the agent state
/// transitions and applied notebook actions. Resolves with the final agent state + notebook.
///
/// Run registration now flows through the host's `modifyNotebook` as a REGISTER_AGENT_RUN action
/// (rather than a separate callback), so we route those into `registered` — keeping `applied` to
/// the result-applying actions the assertions expect.
async function drive(
    notebook: NotebookState,
    focusedKey: number | null,
    aiClient: AgentAIClient,
    opts: {
        intentOverride?: 'sql' | 'visualize' | null;
        resolveOutputColumns?: (scriptKey: number) => Array<{ name: string; type: string | null }> | null;
    } = {},
): Promise<{ agent: AgentRunState | null; notebook: NotebookState; applied: NotebookStateAction[]; registered: Array<[number, number]> }> {
    let agent: AgentRunState | null = null;
    let current = notebook;
    const applied: NotebookStateAction[] = [];
    const registered: Array<[number, number]> = [];
    let clock = 0;

    const modifyNotebook = (action: NotebookStateAction) => {
        if (action.type === REGISTER_AGENT_RUN) {
            registered.push(action.value as [number, number]);
        } else {
            applied.push(action);
        }
        current = reduceNotebookState(current, action, storage, logger, true);
    };

    const host = createNotebookAgentHost({
        notebook,
        contextScriptKey: focusedKey,
        modifyNotebook,
        resolveOutputColumns: opts.resolveOutputColumns,
    });

    await startAgentRun(
        { runId: 1, prompt: 'do the thing', contextScriptKey: focusedKey, intentOverride: opts.intentOverride ?? null },
        {
            aiClient,
            host,
            dispatchAgent: (action: AgentRunAction) => { agent = reduceAgentRun(agent, action); },
            logger,
            now: () => ++clock,
        },
    );
    return { agent, notebook: current, applied, registered };
}

describe('chooseApplyAction', () => {
    it('sql with a focused script edits in place', () => {
        const action = chooseApplyAction('sql', { scriptKey: 42 } as any, 'select 1');
        expect(action.type).toBe(SET_SCRIPT_TEXT);
        expect((action.value as any).scriptKey).toBe(42);
    });
    it('sql with no focus creates a new entry', () => {
        const action = chooseApplyAction('sql', null, 'select 1');
        expect(action.type).toBe(CREATE_NOTEBOOK_ENTRY_WITH_TEXT);
    });
    it('visualize over a SQL script creates a new entry', () => {
        const action = chooseApplyAction('visualize', { scriptKey: 7, annotations: { visualizeQuery: null } } as any, 'visualize x using vegalite ()');
        expect(action.type).toBe(CREATE_NOTEBOOK_ENTRY_WITH_TEXT);
    });
    it('visualize over a VISUALIZE script edits in place', () => {
        const action = chooseApplyAction('visualize', { scriptKey: 7, annotations: { visualizeQuery: { sql: 's' } } } as any, 'visualize x using vegalite ()');
        expect(action.type).toBe(SET_SCRIPT_TEXT);
        expect((action.value as any).scriptKey).toBe(7);
    });
});

describe('startAgentRun — SQL path', () => {
    it('honors a sql intent override and edits the focused script in place', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { agent, notebook, applied } = await drive(state, focusedKey, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.intent).toBe('sql');
        // No classify call should have been made (override).
        expect(ai.prompts.some(p => /exactly one lowercase word/.test(p))).toBe(false);
        expect(applied).toHaveLength(1);
        expect(applied[0].type).toBe(SET_SCRIPT_TEXT);
        expect(notebook.scripts[focusedKey].script.toString()).toBe('select category from sales');
    });

    it('repairs a broken first attempt and converges within 3 attempts', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        // First completion is a syntax error; second is valid.
        const ai = new MockAIClient('sql', ['select form sales (', 'select category from sales']);
        const { agent, applied } = await drive(state, focusedKey, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.attempt).toBe(2);
        // The repair prompt must have carried the previous errors.
        const repairPrompt = ai.prompts[ai.prompts.length - 1];
        expect(repairPrompt).toMatch(/did not pass verification/);
        expect(applied).toHaveLength(1);
        expect(applied[0].type).toBe(SET_SCRIPT_TEXT);
    });

    it('fails cleanly after exhausting attempts', async () => {
        const { state, focusedKey } = buildNotebook('select category from sales');
        const ai = new MockAIClient('sql', ['nonsense (', 'still broken (', 'broken yet again (']);
        const { agent, applied } = await drive(state, focusedKey, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.FAILED);
        expect(agent!.error).toBeTruthy();
        expect(applied).toHaveLength(0);
    });

    it('classifies automatically when no override is given', async () => {
        const { state, focusedKey } = buildNotebook('select category from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { agent } = await drive(state, focusedKey, ai, {});
        expect(agent!.intent).toBe('sql');
        expect(ai.prompts.some(p => /exactly one lowercase word/.test(p))).toBe(true);
    });

    it('registers the agent-run id on the context script', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { registered } = await drive(state, focusedKey, ai, { intentOverride: 'sql' });
        expect(registered).toHaveLength(1);
        expect(registered[0][0]).toBe(focusedKey);
        // The registered handle is the run id (1 in drive()), not the trace id.
        expect(registered[0][1]).toBe(1);
    });

    it('does not register a run when there is no context script', async () => {
        const { state } = buildNotebook('select category, amount from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { registered } = await drive(state, null, ai, { intentOverride: 'sql' });
        expect(registered).toHaveLength(0);
    });
});

describe('startAgentRun — visualize path', () => {
    it('transcodes a Vega-Lite spec and creates a new entry referencing the focused SQL script', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        const spec = JSON.stringify({
            mark: 'bar',
            encoding: {
                x: { field: 'category', type: 'nominal' },
                y: { field: 'amount', type: 'quantitative' },
            },
        });
        const ai = new MockAIClient('visualize', [spec]);
        const { agent, applied } = await drive(state, focusedKey, ai, { intentOverride: 'visualize' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(applied).toHaveLength(1);
        expect(applied[0].type).toBe(CREATE_NOTEBOOK_ENTRY_WITH_TEXT);
        const text = (applied[0].value as any).text as string;
        expect(text).toContain('VISUALIZE dashql.notebook.');
        expect(text).toContain('mark => bar');
    });

    it('strips markdown fences around the JSON', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        const fenced = '```json\n' + JSON.stringify({
            mark: 'bar',
            encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'amount', type: 'quantitative' } },
        }) + '\n```';
        const ai = new MockAIClient('visualize', [fenced]);
        const { agent, applied } = await drive(state, focusedKey, ai, { intentOverride: 'visualize' });
        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(applied).toHaveLength(1);
    });
});

/// Return the generation (non-classify) prompt the model was asked with. With an intent override
/// there is no classify call, so the first captured prompt is the generation prompt.
function generationPrompt(ai: MockAIClient): string {
    const gen = ai.prompts.find(p => !/exactly one lowercase word/.test(p));
    expect(gen).toBeDefined();
    return gen!;
}

describe('startAgentRun — context', () => {
    it('SQL context carries the script text and referenced-table schema, no chart context', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        await drive(state, focusedKey, ai, { intentOverride: 'sql' });

        const prompt = generationPrompt(ai);
        expect(prompt).toContain('Current script:');
        expect(prompt).toContain('select category, amount from sales');
        expect(prompt).toContain('Referenced table schemas:');
        // Columns come from the flattened catalog snapshot, which orders them by name.
        expect(prompt).toContain('sales(amount, category, ts)');
        // No visualize-only blocks leak into the SQL prompt.
        expect(prompt).not.toContain('Source query (feeds the chart):');
        expect(prompt).not.toContain('Output columns');
    });

    it('visualize context carries the source query and the resolved output columns', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        const spec = JSON.stringify({
            mark: 'bar',
            encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'amount', type: 'quantitative' } },
        });
        const ai = new MockAIClient('visualize', [spec]);
        await drive(state, focusedKey, ai, {
            intentOverride: 'visualize',
            // Stand in for the connection state's last-execution result schema.
            resolveOutputColumns: (scriptKey) =>
                scriptKey === focusedKey
                    ? [{ name: 'category', type: 'Utf8' }, { name: 'amount', type: 'Int32' }]
                    : null,
        });

        const prompt = generationPrompt(ai);
        // The source SELECT that feeds the chart is present …
        expect(prompt).toContain('Source query (feeds the chart):');
        expect(prompt).toContain('select category, amount from sales');
        // … along with the output columns (name + type) resolved from the last run.
        expect(prompt).toContain('Output columns');
        expect(prompt).toContain('- category (Utf8)');
        expect(prompt).toContain('- amount (Int32)');
    });

    it('visualize context omits the output columns when the source has never run', async () => {
        const { state, focusedKey } = buildNotebook('select category, amount from sales');
        const spec = JSON.stringify({
            mark: 'bar',
            encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'amount', type: 'quantitative' } },
        });
        const ai = new MockAIClient('visualize', [spec]);
        // No resolver → no last-execution schema available.
        await drive(state, focusedKey, ai, { intentOverride: 'visualize' });

        const prompt = generationPrompt(ai);
        expect(prompt).toContain('Source query (feeds the chart):');
        expect(prompt).not.toContain('Output columns');
    });

    it('editing an existing VISUALIZE reframes as an edit and strips data/$schema from the current chart', async () => {
        // A focused VISUALIZE over the seeded `sales` table becomes the "current chart" in context.
        const { state, focusedKey } = buildNotebook(
            'VISUALIZE sales USING vegalite (mark => bar, encoding => (x => (field => category), y => (field => amount)));',
        );
        // The edited reply flips the mark to line while keeping the encoding.
        const spec = JSON.stringify({
            mark: 'line',
            encoding: { x: { field: 'category', type: 'nominal' }, y: { field: 'amount', type: 'quantitative' } },
        });
        const ai = new MockAIClient('visualize', [spec]);
        const { agent } = await drive(state, focusedKey, ai, { intentOverride: 'visualize' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        const prompt = generationPrompt(ai);
        // The prompt is reframed as an edit that preserves the encoding.
        expect(prompt).toContain('You are EDITING the existing chart');
        expect(prompt).toContain('Current chart (Vega-Lite spec):');
        // The forbidden internal keys are stripped from the shown spec so the example does not
        // contradict the "do not emit data / $schema" rules.
        const chartBlock = prompt.slice(prompt.indexOf('Current chart (Vega-Lite spec):'));
        expect(chartBlock).not.toContain('"$schema"');
        expect(chartBlock).not.toContain('"data"');
    });
});
