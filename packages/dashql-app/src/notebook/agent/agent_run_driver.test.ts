import * as core from '../../core/index.js';

import { startAgentRun, AgentRunDeps, AgentAIClient, chooseApplyAction } from './agent_run_driver.js';
import {
    AgentRunAction,
    AgentRunPhase,
    AgentRunState,
    reduceAgentRun,
} from './agent_run_state.js';
import {
    NotebookState,
    NotebookStateAction,
    SET_SCRIPT_TEXT,
    CREATE_NOTEBOOK_ENTRY_WITH_TEXT,
    createEmptyScriptData,
    reduceNotebookState,
    analyzeAllScriptsInNotebook,
} from '../notebook_state.js';
import { createDatalessConnectorInfo } from '../../connection/connector_info.js';
import { StorageWriter, StorageWriteTaskVariant } from '../../platform/storage/storage_writer.js';
import { Logger } from '../../platform/logger/logger.js';
import { createEmptyMetadata, createPageScript, generateScriptFileName } from '../notebook_types.js';

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

/// Drive a run to completion, collecting the agent state transitions and applied notebook
/// actions. Resolves with the final agent state + notebook.
async function drive(
    notebook: NotebookState,
    focusedKey: number | null,
    aiClient: AgentAIClient,
    opts: { intentOverride?: 'sql' | 'visualize' | null } = {},
): Promise<{ agent: AgentRunState | null; notebook: NotebookState; applied: NotebookStateAction[]; registered: Array<[number, number]> }> {
    let agent: AgentRunState | null = null;
    let current = notebook;
    const applied: NotebookStateAction[] = [];
    const registered: Array<[number, number]> = [];
    let clock = 0;

    const deps: AgentRunDeps = {
        aiClient,
        dispatchAgent: (action: AgentRunAction) => { agent = reduceAgentRun(agent, action); },
        getNotebook: () => current,
        modifyNotebook: (action: NotebookStateAction) => {
            applied.push(action);
            current = reduceNotebookState(current, action, storage, logger, true);
        },
        registerAgentRun: (scriptKey: number, runId: number) => { registered.push([scriptKey, runId]); },
        logger,
        now: () => ++clock,
    };

    await startAgentRun(
        { runId: 1, prompt: 'do the thing', contextScriptKey: focusedKey, intentOverride: opts.intentOverride ?? null },
        deps,
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
        const action = chooseApplyAction('visualize', { scriptKey: 7, annotations: { visualizeQuery: null } } as any, 'visualize x as ()');
        expect(action.type).toBe(CREATE_NOTEBOOK_ENTRY_WITH_TEXT);
    });
    it('visualize over a VISUALIZE script edits in place', () => {
        const action = chooseApplyAction('visualize', { scriptKey: 7, annotations: { visualizeQuery: { sql: 's' } } } as any, 'visualize x as ()');
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
