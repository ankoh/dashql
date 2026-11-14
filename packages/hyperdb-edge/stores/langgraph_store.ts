// The store of LangGraph.js (@langchain/langgraph) on a hot Hyper: long-term memory across threads, items under
// namespaces with filters and semantic search. Semantic search ranks with cosine_similarity over a scan of the
// embeddings: the search indexes of Hyper (vector_search, hybrid_search) need Data Cloud and don't work in hyperdb-wasm.

import {
    BaseStore,
    getTextAtPath,
    validateNamespace,
    type GetOperation,
    type IndexConfig,
    type Item,
    type ListNamespacesOperation,
    type MatchCondition,
    type Operation,
    type OperationResults,
    type PutOperation,
    type SearchItem,
    type SearchOperation,
} from '@langchain/langgraph-checkpoint';

import { setupOnce, type HyperDatabase, type Row, type SqlRunner } from './hyper_database.js';
import { count, json, reals, text, timestamp, toNumber } from './sql.js';

export interface HyperStoreOptions {
    /// Embed the items for semantic search: the dimensions, the embeddings and the fields to embed ("$" the whole value)
    readonly index?: IndexConfig;
    /// The prefix of the table names, `langgraph_` by default
    readonly tablePrefix?: string;
}


/// The path of a namespace. Labels can't contain periods (validateNamespace), so the path is unambiguous.
function namespacePath(namespace: string[]): string {
    return namespace.join('.');
}

type FilterOperators = { $eq?: unknown; $ne?: unknown; $gt?: unknown; $gte?: unknown; $lt?: unknown; $lte?: unknown; $in?: unknown; $nin?: unknown };
const OPERATORS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin']);

function isFilterOperators(value: unknown): value is FilterOperators {
    return typeof value === 'object' && value !== null && Object.keys(value).every((key) => OPERATORS.has(key));
}

/// The condition that a top-level field of the value equals a filter value, as `===` of the in-memory store.
/// `value->'field'` is the stored JSON text of the field, and the stored value is the text of JSON.stringify, so a
/// scalar equals exactly when its JSON.stringify text does. Objects and arrays are never `===`.
function equals(field: string, value: unknown): string {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return `coalesce(CAST(value->${field} AS text) = ${text(JSON.stringify(value))}, FALSE)`;
    }
    return 'FALSE';
}

/// The condition of `Number(field) <op> Number(value)`, for fields with a JSON number
function compares(field: string, operator: string, value: unknown): string {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'FALSE';
    const stored = `CAST(value->${field} AS text)`;
    return `coalesce(CASE WHEN regexp_like(${stored}, '^-?[0-9]') THEN CAST(${stored} AS double precision) ${operator} ${number} END, FALSE)`;
}

/// The SQL condition of the filter of a search
function filterCondition(filter: Record<string, unknown>): string {
    const conditions: string[] = [];
    for (const [key, value] of Object.entries(filter)) {
        const field = text(key);
        if (!isFilterOperators(value)) {
            conditions.push(equals(field, value));
            continue;
        }
        for (const [operator, operand] of Object.entries(value)) {
            switch (operator) {
                case '$eq':
                    conditions.push(equals(field, operand));
                    break;
                case '$ne':
                    conditions.push(`NOT ${equals(field, operand)}`);
                    break;
                case '$gt':
                    conditions.push(compares(field, '>', operand));
                    break;
                case '$gte':
                    conditions.push(compares(field, '>=', operand));
                    break;
                case '$lt':
                    conditions.push(compares(field, '<', operand));
                    break;
                case '$lte':
                    conditions.push(compares(field, '<=', operand));
                    break;
                case '$in':
                    conditions.push(Array.isArray(operand) && operand.length > 0 ? `(${operand.map((v) => equals(field, v)).join(' OR ')})` : 'FALSE');
                    break;
                case '$nin':
                    conditions.push(Array.isArray(operand) && operand.length > 0 ? `NOT (${operand.map((v) => equals(field, v)).join(' OR ')})` : 'TRUE');
                    break;
            }
        }
    }
    return conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
}

function matches(condition: MatchCondition, namespace: string[]): boolean {
    const { matchType, path } = condition;
    if (path.length > namespace.length) return false;
    const offset = matchType === 'prefix' ? 0 : namespace.length - path.length;
    return path.every((label, i) => label === '*' || namespace[offset + i] === label);
}

/// Items of LangGraph's store in a Hyper database.
///
/// `<prefix>store_items` holds one row per item with the value as json, so SQL reads the memories of every namespace;
/// `<prefix>store_vectors` the embeddings of the indexed fields of an item, one row per field.
export class HyperStore extends BaseStore {
    readonly items: string;
    readonly vectors: string;
    /// The fields to embed of an item without fields of its own
    private readonly fields: string[];

    constructor(
        readonly database: HyperDatabase,
        private readonly options: HyperStoreOptions = {},
    ) {
        super();
        const prefix = options.tablePrefix ?? 'langgraph_';
        this.items = database.table(`${prefix}store_items`);
        this.vectors = database.table(`${prefix}store_vectors`);
        this.fields = options.index?.fields ?? ['$'];
    }

    private setup(): Promise<void> {
        return setupOnce(this.database, [
            `CREATE TABLE IF NOT EXISTS ${this.items} (
                prefix text NOT NULL,
                key text NOT NULL,
                value json NOT NULL,
                created_at timestamptz NOT NULL,
                updated_at timestamptz NOT NULL
            )`,
            `CREATE TABLE IF NOT EXISTS ${this.vectors} (
                prefix text NOT NULL,
                key text NOT NULL,
                field text NOT NULL,
                embedding real[] NOT NULL
            )`,
        ]);
    }

    /// Runs the operations as the in-memory store does: reads see the items before the batch, the puts of the batch
    /// apply at its end, the last put of an item wins
    async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
        await this.setup();
        const results: unknown[] = [];
        const puts = new Map<string, PutOperation>();
        for (const operation of operations) {
            if ('namespace' in operation) validateNamespace(operation.namespace, { allowReservedRoot: true });
            if ('value' in operation) {
                puts.set(`${namespacePath(operation.namespace)}\0${operation.key}`, operation);
                results.push(undefined);
            } else if ('key' in operation) {
                results.push(await this.get_(operation));
            } else if ('namespacePrefix' in operation) {
                results.push(await this.search_(operation));
            } else {
                results.push(await this.listNamespaces_(operation));
            }
        }
        if (puts.size > 0) await this.put_([...puts.values()]);
        return results as OperationResults<Op>;
    }

    private item(row: Row): Item {
        return {
            namespace: (row.prefix as string).split('.'),
            key: row.key as string,
            value: JSON.parse(row.value as string),
            createdAt: new Date(toNumber(row.created_at)),
            updatedAt: new Date(toNumber(row.updated_at)),
        };
    }

    private async get_(operation: GetOperation): Promise<Item | null> {
        const rows = await this.database.query(`
            SELECT prefix, key, value, created_at, updated_at FROM ${this.items}
            WHERE prefix = ${text(namespacePath(operation.namespace))} AND key = ${text(operation.key)}`);
        return rows.length === 0 ? null : this.item(rows[0]);
    }

    private async search_(operation: SearchOperation): Promise<SearchItem[]> {
        if (operation.namespacePrefix.length > 0) validateNamespace(operation.namespacePrefix, { allowReservedRoot: true });
        const prefix = namespacePath(operation.namespacePrefix);
        const inPrefix = prefix === '' ? 'TRUE' : `(i.prefix = ${text(prefix)} OR starts_with(i.prefix, ${text(`${prefix}.`)}))`;
        const filter = operation.filter ? filterCondition(operation.filter) : 'TRUE';
        const page = `LIMIT ${count(operation.limit ?? 10)} OFFSET ${count(operation.offset ?? 0)}`;
        const embeddings = this.options.index?.embeddings;
        if (operation.query && embeddings) {
            const query = await embeddings.embedQuery(operation.query);
            // The score of an item is the best of its fields; items without embeddings come last, without a score
            const rows = await this.database.query(`
                SELECT i.prefix, i.key, i.value, i.created_at, i.updated_at, s.score
                FROM ${this.items} i
                LEFT JOIN (
                    SELECT prefix, key, max(cosine_similarity(embedding, ${reals(query)})) AS score
                    FROM ${this.vectors} GROUP BY prefix, key
                ) s ON s.prefix = i.prefix AND s.key = i.key
                WHERE ${inPrefix} AND ${filter}
                ORDER BY s.score DESC NULLS LAST, i.prefix, i.key
                ${page}`);
            return rows.map((row) => ({ ...this.item(row), score: row.score == null ? undefined : (row.score as number) }));
        }
        const rows = await this.database.query(`
            SELECT i.prefix, i.key, i.value, i.created_at, i.updated_at FROM ${this.items} i
            WHERE ${inPrefix} AND ${filter}
            ORDER BY i.prefix, i.key
            ${page}`);
        return rows.map((row) => ({ ...this.item(row), score: undefined }));
    }

    private async listNamespaces_(operation: ListNamespacesOperation): Promise<string[][]> {
        const rows = await this.database.query(`SELECT DISTINCT prefix FROM ${this.items}`);
        let namespaces = rows.map((row) => (row.prefix as string).split('.'));
        if (operation.matchConditions?.length) {
            namespaces = namespaces.filter((namespace) => operation.matchConditions!.every((condition) => matches(condition, namespace)));
        }
        if (operation.maxDepth !== undefined) {
            namespaces = [...new Set(namespaces.map((namespace) => namespace.slice(0, operation.maxDepth).join('.')))].map((path) => path.split('.'));
        }
        namespaces.sort((a, b) => a.join(':').localeCompare(b.join(':')));
        const offset = operation.offset ?? 0;
        return namespaces.slice(offset, offset + (operation.limit ?? namespaces.length));
    }

    /// The texts to embed of the puts, with the item and the field of each
    private textsToEmbed(puts: PutOperation[]): Array<{ text: string; prefix: string; key: string; field: string }> {
        const texts: Array<{ text: string; prefix: string; key: string; field: string }> = [];
        for (const put of puts) {
            if (put.value === null || put.index === false) continue;
            for (const path of put.index ?? this.fields) {
                const found = getTextAtPath(put.value, path);
                found.forEach((value, i) =>
                    texts.push({ text: value, prefix: namespacePath(put.namespace), key: put.key, field: found.length > 1 ? `${path}.${i}` : path }),
                );
            }
        }
        return texts;
    }

    private async put_(puts: PutOperation[]): Promise<void> {
        const embeddings = this.options.index?.embeddings;
        const texts = embeddings ? this.textsToEmbed(puts) : [];
        const vectors = texts.length > 0 ? await embeddings!.embedDocuments(texts.map((t) => t.text)) : [];
        const now = Date.now();
        // A batch takes the same five statements whatever its size: the keys of its items in one VALUES list
        const keys = `(VALUES ${puts.map((put) => `(${text(namespacePath(put.namespace))}, ${text(put.key)})`).join(', ')}) AS k(prefix, key)`;
        const ofKeys = `EXISTS (SELECT 1 FROM ${keys} WHERE k.prefix = d.prefix AND k.key = d.key)`;
        await this.database.transaction(async (tx: SqlRunner) => {
            // An update keeps the creation time of the item
            const existing = await tx.query(`SELECT i.prefix, i.key, i.created_at FROM ${this.items} i JOIN ${keys} ON k.prefix = i.prefix AND k.key = i.key`);
            const createdAt = new Map(existing.map((row) => [`${row.prefix}\0${row.key}`, toNumber(row.created_at)]));
            // The embeddings of an item are those of its last put
            await tx.execute(`DELETE FROM ${this.vectors} AS d WHERE ${ofKeys}`);
            await tx.execute(`DELETE FROM ${this.items} AS d WHERE ${ofKeys}`);
            const rows = puts
                .filter((put) => put.value !== null)
                .map((put) => {
                    const prefix = namespacePath(put.namespace);
                    const created = createdAt.get(`${prefix}\0${put.key}`) ?? now;
                    return `(${text(prefix)}, ${text(put.key)}, ${json(put.value)}, ${timestamp(created)}, ${timestamp(now)})`;
                });
            if (rows.length > 0) {
                await tx.execute(`INSERT INTO ${this.items} (prefix, key, value, created_at, updated_at) VALUES ${rows.join(',\n')}`);
            }
            if (texts.length > 0) {
                const rows = texts.map((t, i) => `(${text(t.prefix)}, ${text(t.key)}, ${text(t.field)}, ${reals(vectors[i])})`);
                await tx.execute(`INSERT INTO ${this.vectors} (prefix, key, field, embedding) VALUES ${rows.join(',\n')}`);
            }
        });
    }
}
