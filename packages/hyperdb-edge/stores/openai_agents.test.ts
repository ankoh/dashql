import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    Agent,
    MemorySession,
    Usage,
    run,
    setTracingDisabled,
    type AgentInputItem,
    type Model,
    type ModelRequest,
    type ModelResponse,
    type SessionHistoryTransactionAwareSession,
} from '@openai/agents';

import { HyperDatabase } from './hyper_database.js';
import { HyperAgentSession } from './openai_agents.js';

function message(role: 'user' | 'assistant', content: string): AgentInputItem {
    return role === 'user'
        ? { type: 'message', role: 'user', content }
        : { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: content }] };
}

/// Run the same calls on a session, return what it reads back and which calls failed
async function exercise(session: SessionHistoryTransactionAwareSession) {
    const results: unknown[] = [];
    const attempt = async (call: () => unknown) => {
        try {
            results.push(await call());
        } catch (e) {
            results.push(`error: ${(e as Error).message}`);
        }
    };
    await session.addItems([message('user', 'one'), message('assistant', 'two')]);
    await session.addItems([message('user', 'three')]);
    await attempt(() => session.getItems());
    await attempt(() => session.getItems(2));
    await attempt(() => session.getItems(0));
    await attempt(() => session.popItem());
    await attempt(() => session.applyHistoryTransaction({ operationId: 'op1', transaction: { type: 'append_items', items: [message('user', 'four')] } }));
    // A retry of the same operation applies nothing, a different transaction under its id fails
    await attempt(() => session.applyHistoryTransaction({ operationId: 'op1', transaction: { type: 'append_items', items: [message('user', 'four')] } }));
    await attempt(() => session.applyHistoryTransaction({ operationId: 'op1', transaction: { type: 'append_items', items: [message('user', 'five')] } }));
    await attempt(() =>
        session.applyHistoryTransaction({
            operationId: 'op2',
            transaction: { type: 'replace_suffix', expectedSuffix: [message('assistant', 'two'), message('user', 'four')], replacement: [message('assistant', 'compacted')] },
        }),
    );
    await attempt(() =>
        session.applyHistoryTransaction({
            operationId: 'op3',
            transaction: { type: 'replace_suffix', expectedSuffix: [message('user', 'stale')], replacement: [] },
        }),
    );
    await attempt(() => session.getItems());
    await attempt(() => session.clearSession());
    await attempt(() => session.getItems());
    return results;
}

/// A model that answers every request with the number of input items it got
class CountingModel implements Model {
    readonly requests: ModelRequest[] = [];
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        const inputs = typeof request.input === 'string' ? 1 : request.input.length;
        return { usage: new Usage(), output: [message('assistant', `I saw ${inputs} items`) as ModelResponse['output'][number]] };
    }
    // eslint-disable-next-line require-yield
    async *getStreamedResponse(): AsyncIterable<never> {
        throw new Error('not streamed');
    }
}

describe('HyperAgentSession', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'hyper-stores-'));
    let database: HyperDatabase;

    beforeAll(async () => {
        setTracingDisabled(true);
        database = await HyperDatabase.open({ file: path.join(folder, 'agents.hyper') });
    });
    afterAll(async () => {
        await database?.close();
    });

    it('reads back what MemorySession reads back', async () => {
        const hyper = await exercise(new HyperAgentSession(database, { sessionId: 'differential' }));
        expect(hyper).toEqual(await exercise(new MemorySession({ sessionId: 'differential' })));
    });

    it('keeps the sessions of a database apart', async () => {
        const a = new HyperAgentSession(database, { sessionId: 'a' });
        const b = new HyperAgentSession(database, { sessionId: 'b' });
        await a.addItems([message('user', 'for a')]);
        await b.addItems([message('user', 'for b')]);
        expect(await a.getItems()).toEqual([message('user', 'for a')]);
        expect(await new HyperAgentSession(database, { sessionId: 'b' }).getItems()).toEqual([message('user', 'for b')]);
    });

    it('carries the history of run() from turn to turn', async () => {
        const model = new CountingModel();
        const agent = new Agent({ name: 'analyst', instructions: 'Answer briefly.', model });
        const session = new HyperAgentSession(database, { sessionId: 'runs' });
        await run(agent, 'first question', { session });
        const second = await run(agent, 'second question', { session });
        // The second turn sees the first question, its answer and the second question
        expect(second.finalOutput).toBe('I saw 3 items');
        expect((await session.getItems()).length).toBe(4);
    });

    it('answers questions about the conversations in SQL', async () => {
        for (const id of ['x', 'y']) {
            const session = new HyperAgentSession(database, { sessionId: `sql-${id}`, tablePrefix: 'analytics_' });
            await session.addItems([message('user', 'q'), message('assistant', 'a'), message('user', 'q2')]);
        }
        const session = new HyperAgentSession(database, { tablePrefix: 'analytics_' });
        const rows = await database.query(`
            SELECT item->>'role' AS role, count(*) AS items, count(DISTINCT session_id) AS sessions
            FROM ${session.items} GROUP BY 1 ORDER BY 1`);
        expect(rows).toEqual([
            { role: 'assistant', items: 2n, sessions: 2n },
            { role: 'user', items: 4n, sessions: 2n },
        ]);
    });
});
