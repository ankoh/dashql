// HyperStore under a LangGraph graph, as an application uses it: memories that one thread of a user writes and another
// recalls by meaning, a thousand memories of twenty users with embeddings of 384 dimensions, a restart, and SQL over
// all memories, a self-join of their embeddings included.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Embeddings } from '@langchain/core/embeddings';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { END, MessagesAnnotation, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import type { PutOperation } from '@langchain/langgraph-checkpoint';

import { HyperDatabase } from './hyper_database.js';
import { HyperCheckpointSaver } from './langgraph_checkpoint.js';
import { HyperStore } from './langgraph_store.js';

const DIMS = 384;

/// Embeds the words of a text into hashed buckets, normalized: texts that share words are alike
class HashedEmbeddings extends Embeddings {
    constructor() {
        super({});
    }
    private embed(text: string): number[] {
        const vector = new Array<number>(DIMS).fill(0);
        for (const word of text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2)) {
            let hash = 2166136261;
            for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
            vector[(hash >>> 0) % DIMS] += 1;
        }
        const norm = Math.hypot(...vector) || 1;
        return vector.map((value) => value / norm);
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
        return texts.map((text) => this.embed(text));
    }
    async embedQuery(text: string): Promise<number[]> {
        return this.embed(text);
    }
}

const index = { dims: DIMS, embeddings: new HashedEmbeddings(), fields: ['text'] };

/// An assistant that remembers what the user tells it and recalls it in any thread of the user
function assistant(database: HyperDatabase) {
    return new StateGraph(MessagesAnnotation)
        .addNode('respond', async (state, config: LangGraphRunnableConfig) => {
            const store = config.store!;
            const user = config.configurable?.user_id as string;
            const said = String(state.messages.at(-1)!.content);
            if (said.startsWith('Remember: ')) {
                const text = said.slice('Remember: '.length);
                await store.put(['memories', user], `m${state.messages.length}`, { text, kind: 'told' });
                return { messages: [new AIMessage(`Noted: ${text}`)] };
            }
            const [best] = await store.search(['memories', user], { query: said, limit: 1 });
            return { messages: [new AIMessage(best ? `You told me: ${best.value.text}` : 'I know nothing about that.')] };
        })
        .addEdge(START, 'respond')
        .addEdge('respond', END)
        .compile({ checkpointer: new HyperCheckpointSaver(database), store: new HyperStore(database, { index }) });
}

const TOPICS = ['coffee', 'tea', 'hiking', 'sql', 'python', 'travel', 'music', 'cooking', 'running', 'books', 'chess', 'cycling'];
const KINDS = ['preference', 'fact', 'plan'];
const USERS = 20;
const MEMORIES_PER_USER = 50;
/// What Ann tells the assistant in the first test, one memory each
const ANN_TOLD = ['my favourite database is Hyper', 'I am allergic to peanuts'];

/// Fifty memories per user: the first enjoys coffee before hiking, the others combine three topics
function memories(user: number): PutOperation[] {
    return Array.from({ length: MEMORIES_PER_USER }, (_, i) => {
        const words = i === 0 ? 'enjoys coffee before hiking on weekends' : [0, 5, 7].map((step) => TOPICS[(user * 7 + i * step + step) % TOPICS.length]).join(' and ');
        return { namespace: ['memories', `user${user}`], key: `m${i}`, value: { text: i === 0 ? words : `talks about ${words}`, kind: KINDS[i % 3], salience: (i * 13) % 10 } };
    });
}

describe('HyperStore under a graph', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hyper-store-usage-')), 'memory.hyper');
    let database: HyperDatabase;

    beforeAll(async () => {
        database = await HyperDatabase.open({ file });
    });
    afterAll(async () => {
        await database?.close();
    });

    it('recalls in one thread what the user said in another', async () => {
        const app = assistant(database);
        const told = { configurable: { thread_id: 'monday', user_id: 'ann' } };
        for (const text of ANN_TOLD) await app.invoke({ messages: [new HumanMessage(`Remember: ${text}`)] }, told);

        const asked = { configurable: { thread_id: 'friday', user_id: 'ann' } };
        const answer = await app.invoke({ messages: [new HumanMessage('Which database do I like?')] }, asked);
        expect(String(answer.messages.at(-1)!.content)).toBe(`You told me: ${ANN_TOLD[0]}`);
        // Another user has no memories of Ann
        const other = await app.invoke({ messages: [new HumanMessage('Which database do I like?')] }, { configurable: { thread_id: 'x', user_id: 'bob' } });
        expect(String(other.messages.at(-1)!.content)).toBe('I know nothing about that.');
    });

    it('searches a thousand memories by meaning, before and after a restart', async () => {
        let store = new HyperStore(database, { index });
        for (let user = 0; user < USERS; ++user) await store.batch(memories(user));

        const search = () => store.search(['memories', 'user7'], { query: 'coffee before hiking', limit: 5 });
        const found = await search();
        expect(found[0].key).toBe('m0');
        expect(found.map((item) => item.score!)).toEqual([...found.map((item) => item.score!)].sort((a, b) => b - a));
        // A filter narrows the search before the ranking
        const plans = await store.search(['memories', 'user7'], { query: 'coffee before hiking', filter: { kind: 'plan', salience: { $gte: 5 } }, limit: 50 });
        expect(plans.length).toBeGreaterThan(0);
        for (const item of plans) expect(item.value.kind === 'plan' && item.value.salience >= 5).toBe(true);

        await database.close();
        database = await HyperDatabase.open({ file });
        store = new HyperStore(database, { index });
        expect(await search()).toEqual(found);
        // The users and Ann
        expect((await store.listNamespaces({ prefix: ['memories'], limit: 100 })).length).toBe(USERS + 1);
    });

    it('answers questions about all memories in SQL', async () => {
        const store = new HyperStore(database, { index });
        const [counts] = await database.query(`
            SELECT count(*) AS memories, count(DISTINCT prefix) AS users, sum(CASE WHEN value->>'kind' = 'plan' THEN 1 ELSE 0 END) AS plans
            FROM ${store.items}`);
        // The memories of the users and the ones that Ann told the assistant
        const plansPerUser = memories(0).filter((op) => op.value!.kind === 'plan').length;
        expect(counts).toEqual({ memories: BigInt(USERS * MEMORIES_PER_USER + ANN_TOLD.length), users: BigInt(USERS + 1), plans: BigInt(USERS * plansPerUser) });
        // The pairs of memories of different users that say the same: a join of a thousand embeddings with each other
        const pairs = await database.query(`
            SELECT count(*) AS pairs FROM ${store.vectors} a JOIN ${store.vectors} b ON a.prefix < b.prefix
            WHERE cosine_similarity(a.embedding, b.embedding) > 0.999 AND a.key = 'm0' AND b.key = 'm0'`);
        // Every user has the coffee memory, so every pair of the twenty users shares it
        expect(pairs).toEqual([{ pairs: BigInt((USERS * (USERS - 1)) / 2) }]);
        const [closest] = await database.query(`
            SELECT max(cosine_similarity(a.embedding, b.embedding)) AS similarity, count(*) AS compared
            FROM ${store.vectors} a JOIN ${store.vectors} b ON a.prefix < b.prefix`);
        // Every memory against every memory of another prefix
        const sizes = [...Array<number>(USERS).fill(MEMORIES_PER_USER), ANN_TOLD.length];
        const total = sizes.reduce((a, b) => a + b, 0);
        expect(Number(closest.compared)).toBe((total * total - sizes.reduce((sum, size) => sum + size * size, 0)) / 2);
        expect(closest.similarity).toBeCloseTo(1, 5);
    });
});
