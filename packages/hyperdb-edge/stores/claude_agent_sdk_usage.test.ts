// HyperSessionStore under query() of the Claude Agent SDK, as an application uses it: Claude Code runs with a fake
// model, an in-process tool and the store as `sessionStore`; the store mirrors the transcripts, survives a restart and
// resumes a session without the transcript on disk. Runs CLAUDE_BINARY when set, the Claude Code of the SDK otherwise.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSdkMcpServer, query, tool, type Options, type SessionKey, type SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { HyperSessionStore } from './claude_agent_sdk.js';
import { HyperDatabase } from './hyper_database.js';
import { messageTexts, startFakeAnthropic, text, toolUse, type FakeAnthropic, type FakeRequest } from './testing/fake_anthropic.js';

const LOOKUP = 'mcp__sales__lookup_sales';
const ROOT = mkdtempSync(path.join(tmpdir(), 'hyper-claude-usage-'));
const WORKSPACE = path.join(ROOT, 'workspace');
mkdirSync(WORKSPACE);

/// The sales tool of the application, in the process of the test. An instance of a server serves one query at a time.
const salesServer = () =>
    createSdkMcpServer({
        name: 'sales',
        version: '1.0.0',
        alwaysLoad: true,
        tools: [
            tool('lookup_sales', 'The sales of a region by month', { region: z.string() }, async ({ region }) => ({
                content: [{ type: 'text', text: Array.from({ length: 12 }, (_, month) => `${region} 2026-${String(month + 1).padStart(2, '0')}: ${1000 + month * 17}`).join('\n') }],
            })),
        ],
    });

/// A store that records what the SDK appends, to compare with what the store reads back
class RecordingStore extends HyperSessionStore {
    readonly appended = new Map<string, SessionStoreEntry[]>();
    override async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
        const name = `${key.projectKey}/${key.sessionId}/${key.subpath ?? ''}`;
        this.appended.set(name, [...(this.appended.get(name) ?? []), ...entries]);
        await super.append(key, entries);
    }
}

/// The prompts of the user in a transcript: user messages with text and without tool results
function prompts(entries: SessionStoreEntry[]): string[] {
    return entries.flatMap((entry) => {
        const content = (entry.message as { content?: unknown } | undefined)?.content;
        if (entry.type !== 'user') return [];
        if (typeof content === 'string') return [content];
        if (!Array.isArray(content) || content.some((block) => block.type === 'tool_result')) return [];
        return content.filter((block) => block.type === 'text').map((block) => block.text as string);
    });
}

/// The tool results since the last prompt of the user
function lookupsSincePrompt(request: FakeRequest): number {
    let lookups = 0;
    for (const message of [...(request.messages ?? [])].reverse()) {
        const blocks = typeof message.content === 'string' ? [] : message.content;
        const results = blocks.filter((block) => block.type === 'tool_result').length;
        if (message.role === 'user' && results === 0) break;
        lookups += results;
    }
    return lookups;
}

/// Every prompt: a lookup of EMEA, one of APAC, then the answer
function analyst(request: FakeRequest) {
    const lookups = lookupsSincePrompt(request);
    if (lookups === 0) return [text('Looking up EMEA.'), toolUse(LOOKUP, { region: 'EMEA' })];
    if (lookups === 1) return [toolUse(LOOKUP, { region: 'APAC' })];
    return [text(`EMEA sold more than APAC, after ${lookups} lookups.`)];
}

/// Run one prompt through Claude Code, return the session id and the result
async function ask(model: FakeAnthropic, store: HyperSessionStore, prompt: string, extra: Partial<Options> & { configDir: string }) {
    const { configDir, ...options } = extra;
    let sessionId: string | undefined;
    let result: string | null = null;
    for await (const message of query({
        prompt,
        options: {
            tools: [],
            mcpServers: { sales: salesServer() },
            allowedTools: [LOOKUP],
            sessionStore: store,
            cwd: WORKSPACE,
            ...(process.env.CLAUDE_BINARY ? { pathToClaudeCodeExecutable: process.env.CLAUDE_BINARY } : {}),
            env: {
                PATH: '/usr/bin:/bin',
                HOME: ROOT,
                CLAUDE_CONFIG_DIR: configDir,
                ANTHROPIC_BASE_URL: model.url,
                ANTHROPIC_API_KEY: 'sk-fake',
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
                DISABLE_AUTOUPDATER: '1',
            },
            ...options,
        },
    })) {
        sessionId ??= message.session_id;
        if (message.type === 'result') {
            expect(message.subtype).toBe('success');
            if (message.subtype === 'success') result = message.result;
        }
    }
    return { sessionId: sessionId!, result };
}

/// The transcript that Claude Code wrote to disk
function transcriptOnDisk(configDir: string, sessionId: string): SessionStoreEntry[] {
    const projects = path.join(configDir, 'projects');
    for (const project of readdirSync(projects)) {
        const file = path.join(projects, project, `${sessionId}.jsonl`);
        try {
            return readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
        } catch {
            // Not in this project
        }
    }
    throw new Error(`no transcript of ${sessionId}`);
}

describe('HyperSessionStore under query()', () => {
    const file = path.join(ROOT, 'agents.hyper');
    let database: HyperDatabase;
    let model: FakeAnthropic;
    let first: { sessionId: string; configDir: string };

    beforeAll(async () => {
        database = await HyperDatabase.open({ file });
        model = await startFakeAnthropic({ mainTool: LOOKUP, turn: analyst });
    });
    afterAll(async () => {
        await model?.close();
        await database?.close();
    });

    it('mirrors what Claude Code writes, a prompt larger than a SQL literal included', async () => {
        const configDir = path.join(ROOT, 'config-first');
        // The user pastes a large export into the prompt, the line of the prompt exceeds one SQL literal
        const attachment = Array.from({ length: 40_000 }, (_, i) => `order-${i},EMEA,${(i * 37) % 1000}.00,'shipped'`).join('\n');
        const store = new RecordingStore(database);
        const { sessionId, result } = await ask(model, store, `Which region sold more? Orders:\n${attachment}`, { configDir, sessionStoreFlush: 'eager' });
        expect(result).toBe('EMEA sold more than APAC, after 2 lookups.');
        first = { sessionId, configDir };

        // The store reads back what the SDK appended, in order
        const [[name, appended]] = [...store.appended];
        const [projectKey] = name.split('/');
        const stored = (await store.load({ projectKey, sessionId }))!;
        expect(stored).toEqual(appended);
        expect(Math.max(...stored.map((entry) => JSON.stringify(entry).length))).toBeGreaterThan(1 << 20);
        // It holds the whole conversation that Claude Code wrote to disk; Claude Code mirrors no api-request entries
        const conversation = transcriptOnDisk(configDir, sessionId).filter((entry) => !entry.type.startsWith('api-request'));
        expect(stored).toEqual(conversation);
    });

    it('resumes a session from the store alone, after a restart', async () => {
        // A new process: the database opens again, the config folder of Claude Code is empty
        await database.close();
        database = await HyperDatabase.open({ file });
        const configDir = path.join(ROOT, 'config-resumed');
        const before = model.main.length;
        const { sessionId, result } = await ask(model, new HyperSessionStore(database), 'And in the last quarter?', { configDir, resume: first.sessionId });
        expect(result).toBe('EMEA sold more than APAC, after 2 lookups.');

        // The model saw the conversation that only the store held: the first prompt and its lookups
        const resumed = model.main[before];
        const texts = messageTexts(resumed);
        expect(texts.some((t) => t.startsWith('Which region sold more?'))).toBe(true);
        expect(texts.filter((t) => t.startsWith('EMEA 2026-01')).length).toBe(1);
        expect(texts.at(-1)).toBe('And in the last quarter?');

        // The store holds the whole conversation of the session it continued
        const [{ project_key: projectKey }] = await database.query(`SELECT DISTINCT project_key FROM ${new HyperSessionStore(database).entries}`);
        expect(sessionId).toBe(first.sessionId);
        const stored = (await new HyperSessionStore(database).load({ projectKey: projectKey as string, sessionId }))!;
        expect(prompts(stored).map((prompt) => prompt.slice(0, 23))).toEqual(['Which region sold more?', 'And in the last quarter']);
    });

    it('keeps sessions that run at once apart', async () => {
        const store = new HyperSessionStore(database);
        const runs = await Promise.all(
            ['north', 'south', 'west'].map((region) => ask(model, store, `How did ${region} do?`, { configDir: path.join(ROOT, `config-${region}`) })),
        );
        for (const run of runs) expect(run.result).toBe('EMEA sold more than APAC, after 2 lookups.');
        const rows = await database.query(`
            SELECT session_id, count(*) AS entries, count(DISTINCT CAST(entry->>'sessionId' AS text)) AS session_ids
            FROM ${store.entries} WHERE subpath = '' GROUP BY session_id`);
        for (const run of runs) {
            const row = rows.find((r) => r.session_id === run.sessionId);
            expect(row).toBeDefined();
            expect(row!.session_ids).toBe(1n);
        }
    });

    it('answers questions about all sessions in SQL', async () => {
        const store = new HyperSessionStore(database);
        // Every lookup of every session, with the region it asked for
        const lookups = await database.query(`
            WITH assistant AS (
                SELECT session_id, entry->'message'->'content' AS content FROM ${store.entries} WHERE type = 'assistant'
            )
            SELECT c->'input'->>'region' AS region, count(*) AS calls, count(DISTINCT session_id) AS sessions
            FROM assistant, json_array_elements(content) AS x(c)
            WHERE c->>'type' = 'tool_use' AND c->>'name' = ${`'${LOOKUP}'`}
            GROUP BY 1 ORDER BY 1`);
        // The first session twice (asked and resumed), three more once
        expect(lookups).toEqual([
            { region: 'APAC', calls: 5n, sessions: 4n },
            { region: 'EMEA', calls: 5n, sessions: 4n },
        ]);
        // The sessions that the SDK lists from the summaries, with the first prompt of each
        const summaries = await store.listSessionSummaries((await database.query(`SELECT DISTINCT project_key FROM ${store.entries}`))[0].project_key as string);
        expect(summaries.length).toBe(4);
    });
});
