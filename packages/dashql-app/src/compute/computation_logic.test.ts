// @vitest-environment node
import * as arrow from 'apache-arrow';
import { describe, expect, it, vi } from 'vitest';

import type { EmbeddedComputeDatabase } from '../platform/database/embedded_database.js';
import { TestLogger } from '../platform/logger/test_logger.js';
import { analyzeTable } from './computation_logic.js';

describe('analyzeTable', () => {
    it('ignores results without columns', async () => {
        const dispatch = vi.fn();
        const connect = vi.fn(() => {
            throw new Error('zero-column results must not open a compute connection');
        });
        const database = { connect } as unknown as EmbeddedComputeDatabase;

        await expect(analyzeTable(
            1,
            arrow.tableFromArrays({}),
            dispatch,
            database,
            new TestLogger(),
        )).resolves.toBeUndefined();

        expect(connect).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalled();
    });
});
