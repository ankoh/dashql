import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { updateInformationSchemaCatalog } from './catalog_query_information_schema.js';
import type { QueryExecutor } from './query_executor.js';

describe('updateInformationSchemaCatalog', () => {
    it('queries all catalogs when no catalog is configured', async () => {
        let query = '';
        const executor = vi.fn<QueryExecutor>((_connectionId, args) => {
            query = args.query;
            return [1, Promise.resolve(arrow.tableFromArrays({}))];
        });

        await expect(updateInformationSchemaCatalog(
            'notebook',
            vi.fn(),
            7,
            '',
            [],
            executor,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        )).rejects.toThrow('information_schema returned no catalog relations');

        expect(query).not.toContain("WHERE table_catalog = ''");
    });

    it('rejects an empty metadata result instead of reporting a successful refresh', async () => {
        const executor = vi.fn<QueryExecutor>(() => [1, Promise.resolve(arrow.tableFromArrays({}))]);

        await expect(updateInformationSchemaCatalog(
            'notebook',
            vi.fn(),
            7,
            'catalog',
            [],
            executor,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        )).rejects.toThrow('information_schema returned no catalog relations');
    });
});
