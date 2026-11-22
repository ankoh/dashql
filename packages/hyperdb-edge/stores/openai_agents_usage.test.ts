// HyperAgentSession under run() of the OpenAI Agents SDK, as an application uses it: an agent with a function tool,
// conversations over several turns with tool calls and large tool outputs, a restart between turns, sessions at once.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Agent, Usage, run, setTracingDisabled, tool, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { z } from 'zod';

import { HyperDatabase } from './hyper_database.js';
import { HyperAgentSession } from './openai_agents.js';

/// The sales tool of the application. An export of all regions is about 1.5 MB, more than one SQL literal holds.
const lookupSales = tool({
    name: 'lookup_sales',
    description: 'The sales of a region by month, or every order with region ALL',
    parameters: z.object({ region: z.string() }),
    execute: async ({ region }) =>
        region === 'ALL'
            ? Array.from({ length: 60_000 }, (_, i) => `order-${i},${['EMEA', 'APAC', 'AMER'][i % 3]},${(i * 37) % 1000}.00`).join('\n')
            : Array.from({ length: 12 }, (_, month) => `${region} 2026-${String(month + 1).padStart(2, '0')}: ${1000 + month * 17}`).join('\n'),
});

type Item = AgentInputItem & { type?: string; role?: string };

/// The items that one turn stores: the prompt, two calls with their results, and the answer
const ITEMS_PER_TURN = 6;
/// The items that the model sees before it answers turn `turn` (from 1): the earlier turns, the prompt, two calls and two results
const itemsBeforeAnswer = (turn: number) => (turn - 1) * ITEMS_PER_TURN + 5;

/// A model that looks up twice per prompt, then answers with what it saw. Decides from its input alone, so it serves
/// any number of sessions at once.
class AnalystModel implements Model {
    readonly requests: ModelRequest[] = [];
    private calls = 0;

    async getResponse(request: ModelRequest): Promise<ModelResponse> {
        this.requests.push(request);
        const input = (typeof request.input === 'string' ? [{ type: 'message', role: 'user', content: request.input }] : request.input) as Item[];
        const promptAt = input.findLastIndex((item) => item.role === 'user');
        const prompt = input[promptAt] as { content: unknown };
        const results = input.slice(promptAt + 1).filter((item) => item.type === 'function_call_result').length;
        const regions = String(prompt.content).includes('Export') ? ['ALL', 'APAC'] : ['EMEA', 'APAC'];
        const output: ModelResponse['output'] =
            results < 2
                ? [{ type: 'function_call', callId: `call_${++this.calls}`, name: 'lookup_sales', arguments: JSON.stringify({ region: regions[results] }), status: 'completed' }]
                : [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: `Answered after ${input.length} items` }] }];
        return { usage: new Usage(), output };
    }
    // eslint-disable-next-line require-yield
    async *getStreamedResponse(): AsyncIterable<never> {
        throw new Error('not streamed');
    }
}

describe('HyperAgentSession under run()', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hyper-openai-usage-')), 'agents.hyper');
    let database: HyperDatabase;
    const model = new AnalystModel();
    const agent = new Agent({ name: 'analyst', instructions: 'Answer with the sales tool.', model, tools: [lookupSales] });
    /// The sessions that the tests wrote, for the totals of the SQL test
    const sessionIds = new Set<string>(['conversation']);

    beforeAll(async () => {
        setTracingDisabled(true);
        database = await HyperDatabase.open({ file });
    });
    afterAll(async () => {
        await database?.close();
    });

    it('carries a conversation with tool calls over a restart', async () => {
        const first = await run(agent, 'Which region sold more?', { session: new HyperAgentSession(database, { sessionId: 'conversation' }) });
        expect(first.finalOutput).toBe(`Answered after ${itemsBeforeAnswer(1)} items`);
        const second = await run(agent, 'Export all orders and compare APAC.', { session: new HyperAgentSession(database, { sessionId: 'conversation' }) });
        expect(second.finalOutput).toBe(`Answered after ${itemsBeforeAnswer(2)} items`);

        // A new process continues the conversation from the database
        await database.close();
        database = await HyperDatabase.open({ file });
        const session = new HyperAgentSession(database, { sessionId: 'conversation' });
        const before = model.requests.length;
        const third = await run(agent, 'And in the last quarter?', { session });
        expect(third.finalOutput).toBe(`Answered after ${itemsBeforeAnswer(3)} items`);

        // The first request of the third turn carried the whole history, the export of 1.5 MB included
        const history = model.requests[before].input as Item[];
        // Two earlier turns and the new prompt
        expect(history.length).toBe(2 * ITEMS_PER_TURN + 1);
        const outputs = history.filter((item) => item.type === 'function_call_result').map((item) => JSON.stringify(item));
        expect(Math.max(...outputs.map((output) => output.length))).toBeGreaterThan(1 << 20);
        expect((await session.getItems()).length).toBe(3 * ITEMS_PER_TURN);
        expect((await session.getItems(ITEMS_PER_TURN)).map((item) => (item as Item).type ?? 'message')).toEqual([
            'message',
            'function_call',
            'function_call_result',
            'function_call',
            'function_call_result',
            'message',
        ]);
    });

    it('keeps sessions that run at once apart', async () => {
        const sessions = Array.from({ length: 5 }, (_, i) => `parallel-${i}`);
        const prompts = (sessionId: string) => [`How did ${sessionId} do?`, 'And the year before?'];
        for (const sessionId of sessions) sessionIds.add(sessionId);
        await Promise.all(
            sessions.map(async (sessionId) => {
                for (const prompt of prompts(sessionId)) {
                    await run(agent, prompt, { session: new HyperAgentSession(database, { sessionId }) });
                }
            }),
        );
        for (const sessionId of sessions) {
            const items = (await new HyperAgentSession(database, { sessionId }).getItems()) as Item[];
            expect(items.length).toBe(prompts(sessionId).length * ITEMS_PER_TURN);
            expect(items.filter((item) => item.role === 'user').map((item) => (item as { content: string }).content)).toEqual(prompts(sessionId));
            // Every result answers a call of the same session
            const calls = new Set(items.filter((item) => item.type === 'function_call').map((item) => (item as { callId: string }).callId));
            for (const result of items.filter((item) => item.type === 'function_call_result')) expect(calls.has((result as { callId: string }).callId)).toBe(true);
        }
    });

    it('answers questions about the conversations in SQL', async () => {
        const items = new HyperAgentSession(database).items;
        // The calls of the tool by region over all sessions, and the sessions with the largest tool outputs
        const regions = await database.query(`
            SELECT CAST(item->>'arguments' AS json)->>'region' AS region, count(*) AS calls, count(DISTINCT session_id) AS sessions
            FROM ${items} WHERE item->>'type' = 'function_call'
            GROUP BY 1 ORDER BY 1`);
        // The same totals, counted over the items of the sessions that the tests wrote
        const expected = new Map<string, { calls: bigint; sessions: Set<string> }>();
        for (const sessionId of sessionIds) {
            for (const item of (await new HyperAgentSession(database, { sessionId }).getItems()) as Item[]) {
                if (item.type !== 'function_call') continue;
                const region = JSON.parse((item as { arguments: string }).arguments).region as string;
                const entry = expected.get(region) ?? { calls: 0n, sessions: new Set<string>() };
                entry.calls += 1n;
                entry.sessions.add(sessionId);
                expected.set(region, entry);
            }
        }
        expect(regions).toEqual(
            [...expected.keys()].sort().map((region) => ({ region, calls: expected.get(region)!.calls, sessions: BigInt(expected.get(region)!.sessions.size) })),
        );
        const [largest] = await database.query(`
            SELECT session_id, sum(length(CAST(item->'output' AS text))) AS output_characters
            FROM ${items} WHERE item->>'type' = 'function_call_result'
            GROUP BY 1 ORDER BY 2 DESC LIMIT 1`);
        expect(largest.session_id).toBe('conversation');
        expect(Number(largest.output_characters)).toBeGreaterThan(1 << 20);
    });
});
