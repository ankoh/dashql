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
        // A second graph on the same database continues the thread
        const resumed = graph().compile({ checkpointer: new HyperCheckpointSaver(graphDatabase) });
        const state = await resumed.invoke({ questions: ['second'] }, config);
        expect(state).toEqual({ questions: ['first', 'second'], answers: ['answer 1', 'answer 2'] });
        const history = [];
        for await (const snapshot of resumed.getStateHistory(config)) history.push(snapshot.metadata?.step);
        expect(history).toEqual([4, 3, 2, 1, 0, -1]);
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
        expect(rows).toEqual([
            { thread_id: 't-a', checkpoints: 3n, last_step: 1n },
            { thread_id: 't-b', checkpoints: 3n, last_step: 1n },
        ]);
    });
});
