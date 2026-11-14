import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Embeddings } from '@langchain/core/embeddings';
import { InMemoryStore, type BaseStore, type SearchItem } from '@langchain/langgraph-checkpoint';

import { HyperDatabase } from './hyper_database.js';
import { HyperStore } from './langgraph_store.js';

const WORDS = ['sql', 'python', 'hiking', 'coffee', 'tea', 'hyper'];

/// Embeds a text as the counts of a few words, plus a constant so that no vector is zero
class WordEmbeddings extends Embeddings {
    constructor() {
        super({});
    }
    private embed(text: string): number[] {
        const words = text.toLowerCase().split(/\W+/);
        return [0.1, ...WORDS.map((word) => words.filter((w) => w === word).length)];
    }
    async embedDocuments(texts: string[]): Promise<number[][]> {
        return texts.map((text) => this.embed(text));
    }
    async embedQuery(text: string): Promise<number[]> {
        return this.embed(text);
    }
}

/// An item without its times, which differ between two stores
function strip(item: SearchItem | null) {
    if (item == null) return null;
    const { createdAt: _createdAt, updatedAt: _updatedAt, score, ...rest } = item;
    return { ...rest, score: score == null ? score : Math.round(score * 1e4) / 1e4 };
}

/// Run the same calls on a store, return what it reads back. Items go in in the order of their namespace and key, the
/// order in which both stores list items without a query.
async function exercise(store: BaseStore) {
    await store.put(['users', 'ann', 'memories'], 'm1', { text: 'Ann likes SQL and Hyper', kind: 'preference', weight: 3, active: true });
    await store.put(['users', 'ann', 'memories'], 'm2', { text: 'Ann drinks coffee', kind: 'fact', weight: 1, active: false, note: null });
    await store.put(['users', 'ann', 'memories'], 'm3', { text: 'Ann goes hiking hiking', kind: 'fact', weight: 2.5, active: true });
    await store.put(['users', 'bob', 'memories'], 'm1', { text: 'Bob writes python python and SQL', kind: 'fact', weight: '7', active: true });
    await store.put(['users', 'bob', 'profile'], 'p', { text: 'Bob drinks tea', kind: 'profile', weight: 0 });
    await store.put(['users', 'ann', 'memories'], 'm2', { text: 'Ann drinks coffee and tea', kind: 'fact', weight: 1, active: false, note: null });
    await store.delete(['users', 'bob', 'profile'], 'p');
    // InMemoryStore keeps the embeddings of a deleted item, HyperStore drops them, so the unindexed item is a new key
    await store.put(['users', 'bob', 'profile'], 'q', { text: 'Bob drinks tea daily', kind: 'profile', weight: 0 }, false);

    const search = async (prefix: string[], options: Parameters<BaseStore['search']>[1]) => (await store.search(prefix, { limit: 50, ...options })).map(strip);
    return {
        get: strip(await store.get(['users', 'ann', 'memories'], 'm2')),
        missing: await store.get(['users', 'ann', 'memories'], 'nope'),
        all: await search([], {}),
        ann: await search(['users', 'ann'], {}),
        notPrefixOfLabel: await search(['users', 'an'], {}),
        kind: await search([], { filter: { kind: 'fact' } }),
        weight: await search([], { filter: { weight: { $gt: 1, $lte: 3 } } }),
        weightText: await search([], { filter: { weight: '7' } }),
        notFact: await search([], { filter: { kind: { $ne: 'fact' } } }),
        kinds: await search([], { filter: { kind: { $in: ['profile', 'preference'] } } }),
        notKinds: await search([], { filter: { kind: { $nin: ['fact'] } } }),
        active: await search([], { filter: { active: true } }),
        nullNote: await search([], { filter: { note: null } }),
        paged: await search([], { limit: 2, offset: 1 }),
        semantic: await search(['users'], { query: 'python and sql' }),
        semanticFiltered: await search(['users'], { query: 'hiking', filter: { kind: 'fact' } }),
        namespaces: await store.listNamespaces(),
        prefixed: await store.listNamespaces({ prefix: ['users', '*', 'memories'] }),
        suffixed: await store.listNamespaces({ suffix: ['profile'] }),
        shallow: await store.listNamespaces({ maxDepth: 2 }),
        pagedNamespaces: await store.listNamespaces({ limit: 1, offset: 1 }),
    };
}

describe('HyperStore', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'hyper-stores-'));
    let database: HyperDatabase;

    beforeAll(async () => {
        database = await HyperDatabase.open({ file: path.join(folder, 'memory.hyper') });
    });
    afterAll(async () => {
        await database?.close();
    });

    it('reads back what InMemoryStore reads back', async () => {
        const index = { dims: WORDS.length + 1, embeddings: new WordEmbeddings(), fields: ['text'] };
        const hyper = await exercise(new HyperStore(database, { index, tablePrefix: 'differential_' }));
        expect(hyper).toEqual(await exercise(new InMemoryStore({ index })));
    });

    it('keeps the creation time of an item it updates', async () => {
        const store = new HyperStore(database, { tablePrefix: 'times_' });
        await store.put(['n'], 'k', { v: 1 });
        const created = (await store.get(['n'], 'k'))!;
        await new Promise((resolve) => setTimeout(resolve, 5));
        await store.put(['n'], 'k', { v: 2 });
        const updated = (await store.get(['n'], 'k'))!;
        expect(updated.value).toEqual({ v: 2 });
        expect(updated.createdAt).toEqual(created.createdAt);
        expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    });

    it('answers questions about the memories in SQL', async () => {
        const store = new HyperStore(database, { tablePrefix: 'analytics_', index: { dims: WORDS.length + 1, embeddings: new WordEmbeddings(), fields: ['text'] } });
        await store.put(['users', 'ann'], 'a', { text: 'sql', kind: 'fact' });
        await store.put(['users', 'ann'], 'b', { text: 'tea', kind: 'preference' });
        await store.put(['users', 'bob'], 'c', { text: 'sql sql hyper', kind: 'fact' });
        // The memories per user and kind, and the pairs of memories of different users that are most alike
        const kinds = await database.query(`
            SELECT split_part(prefix, '.', 2) AS user_name, value->>'kind' AS kind, count(*) AS memories
            FROM ${store.items} GROUP BY 1, 2 ORDER BY 1, 2`);
        expect(kinds).toEqual([
            { user_name: 'ann', kind: 'fact', memories: 1n },
            { user_name: 'ann', kind: 'preference', memories: 1n },
            { user_name: 'bob', kind: 'fact', memories: 1n },
        ]);
        const [alike] = await database.query(`
            SELECT a.key AS a, b.key AS b, cosine_similarity(a.embedding, b.embedding) AS similarity
            FROM ${store.vectors} a JOIN ${store.vectors} b ON a.prefix < b.prefix
            ORDER BY similarity DESC LIMIT 1`);
        expect(alike).toMatchObject({ a: 'a', b: 'c' });
    });
});
