// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { TestLogger } from '../testing/test_logger.js';
import { analyzeTable } from './analyze_table.js';
import { tableFromArrays } from '../testing/arrow_fixtures.js';

describe('analyzeTable', () => {
    it('ignores results without columns', async () => {
        const dispatch = vi.fn();
        const connect = vi.fn(() => {
            throw new Error('zero-column results must not open a compute connection');
        });
        const database = { connect } as unknown as EmbeddedComputeDatabase;

        await expect(analyzeTable(
            1,
            tableFromArrays({}),
            dispatch,
            database,
            new TestLogger(),
        )).resolves.toBeUndefined();

        expect(connect).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});
