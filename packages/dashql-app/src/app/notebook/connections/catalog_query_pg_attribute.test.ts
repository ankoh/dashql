import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import { updatePgSchemaScript } from './catalog_query_pg_attribute.js';
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
