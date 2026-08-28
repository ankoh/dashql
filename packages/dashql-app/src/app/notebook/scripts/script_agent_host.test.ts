import * as core from '../../../core/index.js';

import { startAgentRun, AgentAIClient } from '../agent/agent_run_driver.js';
import {
    AgentRunAction,
    AgentRunPhase,
    AgentRunState,
    reduceAgentRun,
} from '../agent/agent_run_state.js';
import { createNotebookScriptsAgentHost } from './script_agent_host.js';
import {
    NotebookScripts,
    NotebookScriptsAction,
    SET_SCRIPT_TEXT,
    CREATE_SCRIPT_WITH_TEXT,
    REGISTER_AGENT_RUN,
    createEmptyScriptData,
    reduceNotebookScripts,
    analyzeOutdatedScript,
    replaceEditorSessionText,
} from './notebook_scripts.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connections/connector_info.js';
import { StorageWriter, StorageWriteTaskVariant } from '../persistence/storage_writer.js';
import { Logger } from '../../../platform/logger/logger.js';
import { createEmptyMetadata, createScriptRef, generateScriptFileName, scriptDisplayName } from './script_types.js';
import { type AppSettings, type NotebookData, type NotebookEntry, type ScriptData as StoredScriptData, type ScriptFolderData, type StorageBackend, StorageBackendType } from '../persistence/storage_backend.js';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}
class NullStorageBackend implements StorageBackend {
    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }
    async listNotebooks(_manifestPath: string): Promise<NotebookEntry[]> { return []; }
    async loadAppSettings(): Promise<AppSettings | null> { return null; }
    async saveAppSettings(_settings: AppSettings): Promise<void> { }
    async loadNotebook(_notebookId: string): Promise<NotebookData> { return {} as NotebookData; }
    async saveNotebookManifest(_notebookId: string, _data: NotebookData): Promise<void> { }
    async deleteNotebook(_notebookId: string): Promise<void> { }
    async loadNotebookSchema(_notebookId: string): Promise<string | null> { return null; }
    async saveNotebookSchema(_notebookId: string, _sql: string): Promise<void> { }
    async loadNotebookFunctions(_notebookId: string): Promise<string | null> { return null; }
    async saveNotebookFunctions(_notebookId: string, _sql: string): Promise<void> { }
    async loadScriptFolders(_notebookId: string): Promise<ScriptFolderData[]> { return []; }
    async createScriptFolder(_notebookId: string, _folderName: string): Promise<void> { }
    async deleteScriptFolder(_notebookId: string, _folderName: string): Promise<void> { }
    async renameScriptFolder(_notebookId: string, _oldFolderName: string, _newFolderName: string): Promise<void> { }
    async loadScript(_notebookId: string, _folderName: string, _scriptName: string): Promise<StoredScriptData> { return {} as StoredScriptData; }
    async saveScript(_notebookId: string, _folderName: string, _scriptName: string, _sql: string): Promise<void> { }
    async deleteScript(_notebookId: string, _folderName: string, _scriptName: string): Promise<void> { }
    async renameScript(_notebookId: string, _folderName: string, _oldScriptName: string, _newScriptName: string): Promise<void> { }
    async loadScriptDraft(_notebookId: string): Promise<string | null> { return null; }
    async saveScriptDraft(_notebookId: string, _sql: string): Promise<void> { }
    async loadQueryResultCache(_notebookId: string, _hash: string): Promise<null> { return null; }
    async touchQueryResultCacheAccess(_notebookId: string, _hash: string): Promise<void> { }
    async hasCachedQueryResult(_notebookId: string, _hash: string): Promise<boolean> { return false; }
    async saveQueryResultCache(_notebookId: string, _hash: string, _bytes: Uint8Array): Promise<void> { }
    async listQueryResultCache(_notebookId: string): Promise<[]> { return []; }
    async deleteQueryResultCache(_notebookId: string, _hash: string): Promise<void> { }
}
class NullStorageWriter extends StorageWriter {
    public override async write(_key: string, _task: StorageWriteTaskVariant, _debounce?: number): Promise<boolean> {
        return true;
    }
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
const logger = new NullLogger();
const backend = new NullStorageBackend();
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

/// Build a notebookScripts whose single focused script references a `sales` table that lives in the
/// catalog, so generated candidates can resolve columns. Returns a mutable holder so the
/// driver's modifyNotebookScripts can update the state and readers see the latest.
function buildNotebookScripts(focusedSql: string): { state: NotebookScripts; focusedKey: number } {
    const catalog = dql!.createCatalog();
    // Seed the catalog with a `sales` table via a schema script.
    const schemaScript = dql!.createScript(catalog);
    schemaScript.replaceText('create table sales(category text, amount int, ts timestamp);');
    schemaScript.analyze();
    catalog.loadScript(schemaScript, 0);

    const [committedKey, committedData] = createEmptyScriptData(dql!, catalog);
    const file = generateScriptFileName({});
    replaceEditorSessionText(committedData.editorSession, focusedSql);

    const notebookId = 'test-notebookScripts';
    let state: NotebookScripts = {
        instance: dql!,
        notebookId,
        connectionId: 'test-connection',
        notebookMetadata: createEmptyMetadata(),
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        connectionCatalog: catalog,
        scripts: {
            [committedKey]: { ...committedData, folderName: MAIN_FOLDER, fileName: file },
        },
        scriptFolders: {
            [MAIN_FOLDER]: {
                folderName: MAIN_FOLDER,
                scripts: { [file]: createScriptRef(committedKey, file) },
            },
        },
        uncommittedScriptId: 0,
        scriptFocus: { folderName: MAIN_FOLDER, fileName: file, interactionCounter: 0 },
        semanticUserFocus: null,
    };
    // Analyze so annotations (incl. visualizeQuery) and references are populated.
    state = analyzeOutdatedScript(state, committedKey, logger);
    return { state, focusedKey: committedKey };
}

/// Drive a run to completion through the notebookScripts agent host, collecting the agent state
/// transitions and applied notebookScripts actions. Resolves with the final agent state + notebookScripts.
///
/// Run registration now flows through the host's `modifyNotebookScripts` as a REGISTER_AGENT_RUN action
/// (rather than a separate callback), so we route those into `registered` — keeping `applied` to
/// the result-applying actions the assertions expect.
async function drive(
    notebookScripts: NotebookScripts,
    focusedKey: number | null,
    aiClient: AgentAIClient,
    opts: {
        intentOverride?: 'sql' | 'visualize' | null;
        resolveOutputColumns?: (scriptKey: number) => Array<{ name: string; type: string | null }> | null;
    } = {},
): Promise<{ agent: AgentRunState | null; notebookScripts: NotebookScripts; applied: NotebookScriptsAction[]; registered: Array<[number, number]> }> {
    let agent: AgentRunState | null = null;
    let current = notebookScripts;
    const applied: NotebookScriptsAction[] = [];
    const registered: Array<[number, number]> = [];
    let clock = 0;

    const modifyNotebookScripts = (action: NotebookScriptsAction) => {
        if (action.type === REGISTER_AGENT_RUN) {
            registered.push(action.value as [number, number]);
        } else {
            applied.push(action);
        }
        current = reduceNotebookScripts(current, action, storage, logger, true);
    };

    const host = createNotebookScriptsAgentHost({
        notebookScripts: notebookScripts,
        contextScriptKey: focusedKey,
        modifyNotebookScripts,
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
    return { agent, notebookScripts: current, applied, registered };
}

describe('startAgentRun — SQL path', () => {
    it('honors a sql intent override and edits the focused script in place', async () => {
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { agent, notebookScripts, applied } = await drive(state, focusedKey, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.SUCCEEDED);
        expect(agent!.intent).toBe('sql');
        // No classify call should have been made (override).
        expect(ai.prompts.some(p => /exactly one lowercase word/.test(p))).toBe(false);
        expect(applied).toHaveLength(1);
        expect(applied[0].type).toBe(SET_SCRIPT_TEXT);
        expect(notebookScripts.scripts[focusedKey].editorSession.getText()).toBe('select category from sales');
    });

    it('repairs a broken first attempt and converges within 3 attempts', async () => {
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
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
        const { state, focusedKey } = buildNotebookScripts('select category from sales');
        const ai = new MockAIClient('sql', ['nonsense (', 'still broken (', 'broken yet again (']);
        const { agent, applied } = await drive(state, focusedKey, ai, { intentOverride: 'sql' });

        expect(agent!.phase).toBe(AgentRunPhase.FAILED);
        expect(agent!.error).toBeTruthy();
        expect(applied).toHaveLength(0);
    });

    it('classifies automatically when no override is given', async () => {
        const { state, focusedKey } = buildNotebookScripts('select category from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { agent } = await drive(state, focusedKey, ai, {});
        expect(agent!.intent).toBe('sql');
        expect(ai.prompts.some(p => /exactly one lowercase word/.test(p))).toBe(true);
    });

    it('registers the agent-run id on the context script', async () => {
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { registered } = await drive(state, focusedKey, ai, { intentOverride: 'sql' });
        expect(registered).toHaveLength(1);
        expect(registered[0][0]).toBe(focusedKey);
        // The registered handle is the run id (1 in drive()), not the trace id.
        expect(registered[0][1]).toBe(1);
    });

    it('does not register a run when there is no context script', async () => {
        const { state } = buildNotebookScripts('select category, amount from sales');
        const ai = new MockAIClient('sql', ['select category from sales']);
        const { registered } = await drive(state, null, ai, { intentOverride: 'sql' });
        expect(registered).toHaveLength(0);
    });
});

describe('startAgentRun — visualize path', () => {
    it('transcodes a Vega-Lite spec and creates a pretty-formatted entry with the focused SQL', async () => {
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
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
        expect(applied[0].type).toBe(CREATE_SCRIPT_WITH_TEXT);
        const text = (applied[0].value as any).text as string;
        expect(text).toContain('select category, amount\nfrom sales');
        expect(text).toContain('\nvisualize using vegalite');
        expect(text).toContain('mark => bar');
    });

    it('strips markdown fences around the JSON', async () => {
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
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
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
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
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
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
        const { state, focusedKey } = buildNotebookScripts('select category, amount from sales');
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
        const { state, focusedKey } = buildNotebookScripts(
            'SELECT * FROM sales VISUALIZE USING vegalite (mark => bar, encoding => (x => (field => category), y => (field => amount)));',
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
