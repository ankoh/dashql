import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    InMemorySessionStore,
    getSessionMessages,
    importSessionToStore,
    listSessions,
    type SessionKey,
    type SessionStore,
    type SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';

import { HyperSessionStore } from './claude_agent_sdk.js';
import { HyperDatabase } from './hyper_database.js';

const SESSION = '5b0c1f8e-0000-4000-8000-000000000001';
const WORKSPACE = '/work/sales';

/// A transcript as Claude Code writes it: a question, a tool call, its result, the answer, a summary without uuid
function transcript(sessionId: string): SessionStoreEntry[] {
    const base = { sessionId, cwd: WORKSPACE, isSidechain: false, userType: 'external', version: '2.1.0', gitBranch: 'main' };
    return [
        { ...base, type: 'user', uuid: `${sessionId}-u1`, parentUuid: null, timestamp: '2026-11-14T10:00:00.000Z', message: { role: 'user', content: 'Which region sold most?' } },
        {
            ...base,
            type: 'assistant',
            uuid: `${sessionId}-a1`,
            parentUuid: `${sessionId}-u1`,
            timestamp: '2026-11-14T10:00:02.000Z',
            message: {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                model: 'claude-test',
                content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'hyperdb-edge run --db sales.hyper -c "select 1"' } }],
                stop_reason: 'tool_use',
                usage: { input_tokens: 120, output_tokens: 40 },
            },
        },
        {
            ...base,
            type: 'user',
            uuid: `${sessionId}-u2`,
            parentUuid: `${sessionId}-a1`,
            timestamp: '2026-11-14T10:00:03.000Z',
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'EMEA | 42', is_error: false }] },
        },
        {
            ...base,
            type: 'assistant',
            uuid: `${sessionId}-a2`,
            parentUuid: `${sessionId}-u2`,
            timestamp: '2026-11-14T10:00:05.000Z',
            message: {
                id: 'msg_2',
                type: 'message',
                role: 'assistant',
                model: 'claude-test',
                content: [{ type: 'text', text: 'EMEA, with 42.' }],
                stop_reason: 'end_turn',
                usage: { input_tokens: 180, output_tokens: 12 },
            },
        },
        { type: 'summary', summary: 'Sales by region', leafUuid: `${sessionId}-a2` },
    ];
}

/// Run the same writes on a store, return what it reads back
async function exercise(store: SessionStore) {
    const main: SessionKey = { projectKey: 'p', sessionId: 's1' };
    const subagent: SessionKey = { ...main, subpath: 'subagents/agent-1' };
    const entries = transcript('s1');
    await store.append(main, entries.slice(0, 2));
    await store.append(subagent, transcript('s1-sub').slice(0, 2));
    await store.append(main, entries.slice(2));
    await store.append({ projectKey: 'p', sessionId: 's2' }, transcript('s2').slice(0, 1));
    await store.append({ projectKey: 'other', sessionId: 's3' }, transcript('s3').slice(0, 1));
    const read = async () => ({
        main: await store.load(main),
        subagent: await store.load(subagent),
        missing: await store.load({ projectKey: 'p', sessionId: 'nope' }),
        subkeys: await store.listSubkeys!(main),
        sessions: (await store.listSessions!('p')).map((s) => s.sessionId).sort(),
        summaries: (await store.listSessionSummaries!('p')).map((s) => ({ sessionId: s.sessionId, data: s.data })).sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    });
    const written = await read();
    await store.delete!(subagent);
    const subagentDeleted = await read();
    await store.delete!(main);
    const mainDeleted = await read();
    return { written, subagentDeleted, mainDeleted };
}

describe('HyperSessionStore', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'hyper-stores-'));
    let database: HyperDatabase;

    beforeAll(async () => {
        database = await HyperDatabase.open({ file: path.join(folder, 'agents.hyper') });
    });
    afterAll(async () => {
        await database?.close();
    });

    it('reads back what the in-memory store of the SDK reads back', async () => {
        const store = new HyperSessionStore(database, { tablePrefix: 'differential_' });
        expect(await exercise(store)).toEqual(await exercise(new InMemorySessionStore()));
    });

    it('stores an entry with a uuid once', async () => {
        const store = new HyperSessionStore(database, { tablePrefix: 'replay_' });
        const key = { projectKey: 'p', sessionId: 'replayed' };
        await store.append(key, transcript('replayed'));
        await store.append(key, transcript('replayed'));
        const loaded = (await store.load(key))!;
        // The four entries with a uuid once, the summary without one twice
        expect(loaded.map((entry) => entry.type)).toEqual(['user', 'assistant', 'user', 'assistant', 'summary', 'summary']);
    });

    it('serves the session helpers of the SDK', async () => {
        // A transcript on disk as Claude Code leaves it, imported into the store and read back through the SDK
        const config = mkdtempSync(path.join(tmpdir(), 'claude-config-'));
        const project = path.join(config, 'projects', WORKSPACE.replace(/[^a-zA-Z0-9]/g, '-'));
        mkdirSync(project, { recursive: true });
        writeFileSync(path.join(project, `${SESSION}.jsonl`), transcript(SESSION).map((entry) => JSON.stringify(entry)).join('\n') + '\n');
        const previous = process.env.CLAUDE_CONFIG_DIR;
        process.env.CLAUDE_CONFIG_DIR = config;
        try {
            const fromDisk = await getSessionMessages(SESSION, { dir: WORKSPACE });
            expect(fromDisk.length).toBeGreaterThan(0);

            const store = new HyperSessionStore(database, { tablePrefix: 'helpers_' });
            await importSessionToStore(SESSION, store, { dir: WORKSPACE });
            expect(await getSessionMessages(SESSION, { dir: WORKSPACE, sessionStore: store })).toEqual(fromDisk);
            const sessions = await listSessions({ dir: WORKSPACE, sessionStore: store } as Parameters<typeof listSessions>[0]);
            expect(sessions.map((session) => session.sessionId)).toEqual([SESSION]);
            expect(sessions[0].firstPrompt).toBe('Which region sold most?');
        } finally {
            if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
            else process.env.CLAUDE_CONFIG_DIR = previous;
        }
    });

    it('answers questions about the sessions in SQL', async () => {
        const store = new HyperSessionStore(database, { tablePrefix: 'analytics_' });
        for (const session of ['a', 'b', 'c']) await store.append({ projectKey: 'p', sessionId: session }, transcript(session));
        // The tool calls and the tokens of every session, straight from the transcripts
        const rows = await database.query(`
            WITH assistant AS (
                SELECT session_id, entry->'message' AS message FROM ${store.entries} WHERE type = 'assistant'
            )
            SELECT c->>'name' AS tool, count(*) AS calls, count(DISTINCT session_id) AS sessions
            FROM assistant, json_array_elements(message->'content') AS x(c)
            WHERE c->>'type' = 'tool_use'
            GROUP BY 1`);
        expect(rows).toEqual([{ tool: 'Bash', calls: 3n, sessions: 3n }]);
        const [tokens] = await database.query(`
            SELECT sum(CAST(entry->'message'->'usage'->>'output_tokens' AS bigint)) AS output_tokens
            FROM ${store.entries} WHERE type = 'assistant'`);
        expect(tokens.output_tokens).toBe(156n);
    });
});
