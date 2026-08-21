import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { queryPgAttribute, updatePgSchemaScript } from './catalog_query_pg_attribute.js';
import type { QueryExecutor } from './query_executor.js';

describe('updatePgSchemaScript', () => {
    it('rejects an empty relation result instead of reporting a successful refresh', async () => {
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(arrow.tableFromArrays({}))]);

        await expect(updatePgSchemaScript(
            { info: vi.fn() } as any,
            'notebook',
            vi.fn(),
            7,
            '',
            [],
            executor,
            {} as any,
            {} as any,
        )).rejects.toThrow('pg_attribute returned no catalog relations');
    });
});

describe('queryPgAttribute', () => {
    it('safely qualifies an attached database alias', async () => {
        let query = '';
        const executor = vi.fn<QueryExecutor>((_connectionId, args) => {
            query = args.query;
            return [1, Promise.resolve(arrow.tableFromArrays({}))];
        });

        await queryPgAttribute('notebook', vi.fn(), 7, 'catalog', [], executor, 'db"name');

        expect(query).toContain('FROM "db""name"."pg_catalog".pg_class c');
        expect(query).toContain('JOIN "db""name"."pg_catalog".pg_attribute a');
    });
});
