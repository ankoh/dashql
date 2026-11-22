import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { validate } from '@langchain/langgraph-checkpoint-validation';

import { HyperDatabase } from './hyper_database.js';
import { HyperCheckpointSaver } from './langgraph_checkpoint.js';

const folder = mkdtempSync(path.join(tmpdir(), 'hyper-stores-'));
let database: HyperDatabase | null = null;
let savers = 0;

// The conformance suite of LangGraph for checkpointers, with fresh tables for every set of validations
validate({
    checkpointerName: 'HyperCheckpointSaver',
    beforeAllTimeout: 60_000,
    async beforeAll() {
        database = await HyperDatabase.open({ file: path.join(folder, 'validation.hyper') });
    },
    async afterAll() {
        await database?.close();
    },
    createCheckpointer() {
        return new HyperCheckpointSaver(database!, { tablePrefix: `validation_${savers++}_` });
    },
});

describe('HyperCheckpointSaver in a graph', () => {
    let graphDatabase: HyperDatabase;

    beforeAll(async () => {
        graphDatabase = await HyperDatabase.open({ file: path.join(folder, 'graph.hyper') });
    });
    afterAll(async () => {
        await graphDatabase?.close();
    });

    const State = Annotation.Root({
        questions: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
        answers: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
    });
    const graph = () =>
        new StateGraph(State)
            .addNode('answer', (state) => ({ answers: [`answer ${state.questions.length}`] }))
            .addEdge(START, 'answer')
            .addEdge('answer', END);

    it('resumes a thread from its checkpoints', async () => {
        const app = graph().compile({ checkpointer: new HyperCheckpointSaver(graphDatabase) });
        const config = { configurable: { thread_id: 'thread-1' } };
        await app.invoke({ questions: ['first'] }, config);
        const steps = async (compiled: typeof app) => {
            const history = [];
            for await (const snapshot of compiled.getStateHistory(config)) history.push(snapshot.metadata!.step);
            return history;
        };
        const before = await steps(app);
        // A second graph on the same database continues the thread
        const resumed = graph().compile({ checkpointer: new HyperCheckpointSaver(graphDatabase) });
        const state = await resumed.invoke({ questions: ['second'] }, config);
        expect(state).toEqual({ questions: ['first', 'second'], answers: ['answer 1', 'answer 2'] });
        // The thread continues after the checkpoints of the first run, newest first
        const after = await steps(resumed);
        expect(after.length).toBeGreaterThan(before.length);
        expect(after.slice(-before.length)).toEqual(before);
        for (let i = 1; i < after.length; ++i) expect(after[i]).toBeLessThan(after[i - 1]);
    });

    it('answers questions about the runs in SQL', async () => {
        const saver = new HyperCheckpointSaver(graphDatabase);
        const app = graph().compile({ checkpointer: saver });
        for (const thread of ['t-a', 't-b']) await app.invoke({ questions: ['q'] }, { configurable: { thread_id: thread } });
        // The steps of every thread, from the metadata of its checkpoints
        const rows = await graphDatabase.query(`
            SELECT thread_id, count(*) AS checkpoints, max(CAST(metadata_json->>'step' AS bigint)) AS last_step
            FROM ${saver.checkpoints} WHERE thread_id IN ('t-a', 't-b')
            GROUP BY thread_id ORDER BY thread_id`);
        // The same as the saver lists for each thread
        const listed = [];
        for (const thread_id of ['t-a', 't-b']) {
            const tuples = [];
            for await (const tuple of saver.list({ configurable: { thread_id } })) tuples.push(tuple);
            listed.push({ thread_id, checkpoints: BigInt(tuples.length), last_step: BigInt(Math.max(...tuples.map((tuple) => tuple.metadata!.step))) });
        }
        expect(rows).toEqual(listed);
    });
});
