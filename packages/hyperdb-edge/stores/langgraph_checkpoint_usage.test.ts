// HyperCheckpointSaver under a LangGraph graph, as an application uses it: a model that calls tools, an approval by a
// human in a subgraph (interrupt), the approved calls fanned out in parallel (Send), resumed after a restart, time travel
// to a checkpoint before the approval, and threads at once.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Annotation, Command, END, MessagesAnnotation, START, Send, StateGraph, interrupt } from '@langchain/langgraph';

import { HyperDatabase } from './hyper_database.js';
import { HyperCheckpointSaver } from './langgraph_checkpoint.js';

type ToolCall = { id: string; name: string; args: { region: string } };

const State = Annotation.Root({
    ...MessagesAnnotation.spec,
    /// Whether the human approved the last tool calls, null before the review
    approved: Annotation<boolean | null>({ reducer: (_, next) => next, default: () => null }),
    /// The findings of the lookups, in the order of the calls
    findings: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});
type StateType = typeof State.State;

let calls = 0;

/// The model: asks for two lookups after a prompt, answers after their results, gives up when the human rejected
function model(state: StateType) {
    const last = state.messages.at(-1)!;
    if (HumanMessage.isInstance(last)) {
        const toolCalls: ToolCall[] = ['EMEA', 'APAC'].map((region) => ({ id: `call_${++calls}`, name: 'lookup_sales', args: { region } }));
        return { messages: [new AIMessage({ content: 'Looking up two regions.', tool_calls: toolCalls })], approved: null };
    }
    if (ToolMessage.isInstance(last)) return { messages: [new AIMessage(`Done: ${state.findings.join('; ')}`)] };
    return { messages: [new AIMessage('Not approved, nothing looked up.')] };
}

/// The review of the tool calls by a human, a subgraph of its own
const review = new StateGraph(State)
    .addNode('ask', (state: StateType) => {
        const request = state.messages.at(-1) as AIMessage;
        const decision = interrupt({ question: 'Run these lookups?', calls: request.tool_calls?.map((call) => call.args) });
        return { approved: decision === 'approve' };
    })
    .addEdge(START, 'ask')
    .addEdge('ask', END)
    .compile();

/// One lookup, run in parallel with the others of the same request
async function lookup(input: { call: ToolCall }) {
    const { call } = input;
    const total = call.args.region === 'EMEA' ? 4200 : 3100;
    return { messages: [new ToolMessage({ content: `${call.args.region}: ${total}`, tool_call_id: call.id })], findings: [`${call.args.region} ${total}`] };
}

function graph(checkpointer: HyperCheckpointSaver) {
    return new StateGraph(State)
        .addNode('model', model)
        .addNode('review', review)
        .addNode('lookup', lookup as unknown as (state: StateType) => Promise<Partial<StateType>>)
        .addEdge(START, 'model')
        .addConditionalEdges('model', (state: StateType) => ((state.messages.at(-1) as AIMessage).tool_calls?.length ? 'review' : END))
        .addConditionalEdges('review', (state: StateType) =>
            state.approved ? (state.messages.at(-1) as AIMessage).tool_calls!.map((call) => new Send('lookup', { call })) : 'model',
        )
        .addEdge('lookup', 'model')
        .compile({ checkpointer });
}

/// The interrupts that a run stopped at
function interrupts(result: unknown): Array<{ value: unknown }> {
    return (result as { __interrupt__?: Array<{ value: unknown }> }).__interrupt__ ?? [];
}

function texts(messages: BaseMessage[]): string[] {
    return messages.map((message) => `${message.getType()}: ${String(message.content)}`);
}

describe('HyperCheckpointSaver under a graph', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hyper-langgraph-usage-')), 'graphs.hyper');
    let database: HyperDatabase;
    const thread = { configurable: { thread_id: 'review' } };
    /// The threads that run at once
    const threads = Array.from({ length: 10 }, (_, i) => ({ configurable: { thread_id: `parallel-${i}` } }));
    const approves = (i: number) => i % 2 === 0;

    beforeAll(async () => {
        database = await HyperDatabase.open({ file });
    });
    afterAll(async () => {
        await database?.close();
    });

    it('resumes an approval in a subgraph after a restart', async () => {
        const interrupted = await graph(new HyperCheckpointSaver(database)).invoke({ messages: [new HumanMessage('Which region sold more?')] }, thread);
        expect(interrupts(interrupted)[0].value).toEqual({ question: 'Run these lookups?', calls: [{ region: 'EMEA' }, { region: 'APAC' }] });

        // A new process: the database opens again, the graph and the saver are new
        await database.close();
        database = await HyperDatabase.open({ file });
        const app = graph(new HyperCheckpointSaver(database));
        const waiting = await app.getState(thread, { subgraphs: true });
        expect(waiting.next).toEqual(['review']);
        // The state of the subgraph comes from its checkpoints, under a namespace of their own
        const subgraph = waiting.tasks[0].state as Awaited<ReturnType<typeof app.getState>>;
        expect(subgraph.config.configurable?.checkpoint_ns).toMatch(/^review:/);
        expect(subgraph.next).toEqual(['ask']);

        const done = await app.invoke(new Command({ resume: 'approve' }), thread);
        expect(texts(done.messages)).toEqual([
            'human: Which region sold more?',
            'ai: Looking up two regions.',
            'tool: EMEA: 4200',
            'tool: APAC: 3100',
            'ai: Done: EMEA 4200; APAC 3100',
        ]);
        expect(done.findings).toEqual(['EMEA 4200', 'APAC 3100']);
    });

    it('travels back to the approval and takes the other branch', async () => {
        const app = graph(new HyperCheckpointSaver(database));
        const history = [];
        for await (const snapshot of app.getStateHistory(thread)) history.push(snapshot);
        // The checkpoint that waited for the approval
        const beforeApproval = history.find((snapshot) => snapshot.next.includes('review') && snapshot.tasks.some((task) => task.interrupts.length > 0))!;
        expect(beforeApproval).toBeDefined();

        // Replaying from it forks the thread and asks again; a resume at the old checkpoint would reuse its answer
        const replayed = await app.invoke(null, beforeApproval.config);
        expect(interrupts(replayed)[0].value).toEqual({ question: 'Run these lookups?', calls: [{ region: 'EMEA' }, { region: 'APAC' }] });
        const rejected = await app.invoke(new Command({ resume: 'reject' }), thread);
        expect(texts(rejected.messages).at(-1)).toBe('ai: Not approved, nothing looked up.');
        expect(rejected.findings).toEqual([]);
        // The thread now ends in the rejected branch, the approved branch stays in its checkpoints
        expect(texts((await app.getState(thread)).values.messages).at(-1)).toBe('ai: Not approved, nothing looked up.');
        const approved = await app.getState(history[0].config);
        expect(approved.values.findings).toEqual(['EMEA 4200', 'APAC 3100']);
    });

    it('keeps threads that run at once apart', async () => {
        const app = graph(new HyperCheckpointSaver(database));
        await Promise.all(
            threads.map(async (config, i) => {
                await app.invoke({ messages: [new HumanMessage(`Question ${i}`)] }, config);
                await app.invoke(new Command({ resume: approves(i) ? 'approve' : 'reject' }), config);
            }),
        );
        for (const [i, config] of threads.entries()) {
            const state = await app.getState(config);
            expect(texts(state.values.messages)[0]).toBe(`human: Question ${i}`);
            expect(state.values.findings).toEqual(approves(i) ? ['EMEA 4200', 'APAC 3100'] : []);
            expect(state.next).toEqual([]);
        }
    });

    it('answers questions about the runs in SQL', async () => {
        const saver = new HyperCheckpointSaver(database);
        // The supersteps of every thread, and the approvals that the threads waited for
        const steps = await database.query(`
            SELECT thread_id, max(CAST(metadata_json->>'step' AS bigint)) AS last_step, count(*) AS checkpoints
            FROM ${saver.checkpoints} WHERE checkpoint_ns = '' AND thread_id LIKE 'parallel-%'
            GROUP BY thread_id ORDER BY thread_id`);
        expect(steps.length).toBe(threads.length);
        // Approved threads take more steps: the lookups and the answer after them
        const lastStep = (approved: boolean) =>
            threads.flatMap((config, i) => (approves(i) === approved ? [Number(steps.find((row) => row.thread_id === config.configurable.thread_id)!.last_step)] : []));
        expect(Math.min(...lastStep(true))).toBeGreaterThan(Math.max(...lastStep(false)));
        // Every one of them waited for an approval
        const [waits] = await database.query(`
            SELECT count(DISTINCT thread_id) AS threads FROM ${saver.writes} WHERE channel = '__interrupt__' AND thread_id LIKE 'parallel-%'`);
        expect(waits.threads).toBe(BigInt(threads.length));
        // Each channel value is stored once per version: far fewer blobs than checkpoints times channels
        const [sizes] = await database.query(`
            SELECT (SELECT count(*) FROM ${saver.blobs}) AS blobs,
                   (SELECT count(*) FROM ${saver.checkpoints}) AS checkpoints`);
        expect(Number(sizes.blobs)).toBeLessThan(Number(sizes.checkpoints) * Object.keys(State.spec).length);
    });
});
