import { vi } from 'vitest';

import * as computationLogic from './computation_logic.js';

vi.mock('./computation_logic.js', () => ({
    filterTable: vi.fn(),
    sortTable: vi.fn(),
    computeTableAggregates: vi.fn(),
    computeSystemColumns: vi.fn(),
    computeColumnAggregates: vi.fn(),
    computeFilteredColumnAggregates: vi.fn(),
}));

import { AsyncValue } from '../utils/async_value.js';
import { LoggableException } from '../platform/logger.js';
import { TestLogger } from '../platform/test_logger.js';
import { TaskStatus } from './computation_types.js';
import {
    ComputationAction,
    UPDATE_SCHEDULER_TASK,
    UNREGISTER_SCHEDULER_TASK,
    TABLE_FILTERING_SUCCEEDED,
    TABLE_ORDERING_SUCCEDED,
    TABLE_AGGREGATION_SUCCEEDED,
    SYSTEM_COLUMN_COMPUTATION_SUCCEEDED,
    COLUMN_AGGREGATION_SUCCEEDED,
    FILTERED_COLUMN_AGGREGATION_SUCCEEDED,
} from './computation_state.js';
import {
    processTask,
    TaskVariant,
    TABLE_FILTERING_TASK,
    TABLE_ORDERING_TASK,
    TABLE_AGGREGATION_TASK,
    SYSTEM_COLUMN_COMPUTATION_TASK,
    COLUMN_AGGREGATION_TASK,
    FILTERED_COLUMN_AGGREGATION_TASK,
} from './computation_scheduler.js';
import { Dispatch } from '../utils/variant.js';

describe('processTask', () => {
    let logger: TestLogger;
    let dispatch: Dispatch<ComputationAction>;

    beforeEach(() => {
        logger = new TestLogger();
        dispatch = vi.fn() as unknown as Dispatch<ComputationAction>;
        vi.clearAllMocks();
        vi.mocked(computationLogic.filterTable).mockResolvedValue(null);
        vi.mocked(computationLogic.sortTable).mockResolvedValue({} as any);
        vi.mocked(computationLogic.computeTableAggregates).mockResolvedValue([{} as any, []]);
        vi.mocked(computationLogic.computeSystemColumns).mockResolvedValue([{} as any, {} as any, []]);
        vi.mocked(computationLogic.computeColumnAggregates).mockResolvedValue({} as any);
        vi.mocked(computationLogic.computeFilteredColumnAggregates).mockResolvedValue(null);
    });

    it('warns and skips if task has no taskId', async () => {
        const task: TaskVariant = {
            type: TABLE_FILTERING_TASK,
            value: { tableId: 1 } as any,
            result: new AsyncValue(),
        };

        await processTask(task, dispatch, logger);

        expect(dispatch).not.toHaveBeenCalled();
        expect(computationLogic.filterTable).not.toHaveBeenCalled();
    });

    it('processes TABLE_FILTERING_TASK successfully', async () => {
        const mockFilter = { inputRowNumberColumnName: 'rowNumber', dataTable: {} as any, dataFrame: {} as any, tableEpoch: null };
        vi.mocked(computationLogic.filterTable).mockResolvedValue(mockFilter);

        const result = new AsyncValue<typeof mockFilter | null, LoggableException>();
        const task: TaskVariant = {
            type: TABLE_FILTERING_TASK,
            value: { tableId: 42 } as any,
            result: result as any,
            taskId: 1,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls[0][0]).toMatchObject({ type: UPDATE_SCHEDULER_TASK, value: [task, expect.objectContaining({ status: TaskStatus.TASK_RUNNING })] });
        expect(calls[1][0]).toEqual({ type: TABLE_FILTERING_SUCCEEDED, value: [42, mockFilter] });
        expect(calls[2][0]).toEqual({ type: UNREGISTER_SCHEDULER_TASK, value: task });
        await expect(result.getValue()).resolves.toBe(mockFilter);
    });

    it('processes TABLE_ORDERING_TASK successfully', async () => {
        const mockOrdered = { orderingConstraints: [], dataTable: {} as any, dataTableFieldsByName: new Map(), dataFrame: {} as any };
        vi.mocked(computationLogic.sortTable).mockResolvedValue(mockOrdered);

        const result = new AsyncValue<typeof mockOrdered, LoggableException>();
        const task: TaskVariant = {
            type: TABLE_ORDERING_TASK,
            value: { tableId: 42 } as any,
            result: result as any,
            taskId: 2,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls[0][0]).toMatchObject({ type: UPDATE_SCHEDULER_TASK, value: [task, expect.objectContaining({ status: TaskStatus.TASK_RUNNING })] });
        expect(calls[1][0]).toEqual({ type: TABLE_ORDERING_SUCCEDED, value: [42, mockOrdered] });
        expect(calls[2][0]).toEqual({ type: UNREGISTER_SCHEDULER_TASK, value: task });
        await expect(result.getValue()).resolves.toBe(mockOrdered);
    });

    it('processes TABLE_AGGREGATION_TASK successfully', async () => {
        const mockTableAgg = { dataFrame: {} as any, table: {} as any, tableFieldsByName: new Map(), tableFormatter: {} as any, countStarFieldName: '_count_star' };
        vi.mocked(computationLogic.computeTableAggregates).mockResolvedValue([mockTableAgg, []]);

        const result = new AsyncValue<[typeof mockTableAgg, any[]], LoggableException>();
        const task: TaskVariant = {
            type: TABLE_AGGREGATION_TASK,
            value: { tableId: 42 } as any,
            result: result as any,
            taskId: 3,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls[0][0]).toMatchObject({ type: UPDATE_SCHEDULER_TASK, value: [task, expect.objectContaining({ status: TaskStatus.TASK_RUNNING })] });
        expect(calls[1][0]).toEqual({ type: TABLE_AGGREGATION_SUCCEEDED, value: [42, mockTableAgg] });
        expect(calls[2][0]).toEqual({ type: UNREGISTER_SCHEDULER_TASK, value: task });
        await expect(result.getValue()).resolves.toEqual([mockTableAgg, []]);
    });

    it('processes SYSTEM_COLUMN_COMPUTATION_TASK successfully', async () => {
        const mockTable = { schema: {} } as any;
        const mockDataFrame = { id: 99 } as any;
        const mockColGroups: any[] = [];
        vi.mocked(computationLogic.computeSystemColumns).mockResolvedValue([mockTable, mockDataFrame, mockColGroups]);

        const result = new AsyncValue<[typeof mockTable, typeof mockDataFrame, typeof mockColGroups], LoggableException>();
        const task: TaskVariant = {
            type: SYSTEM_COLUMN_COMPUTATION_TASK,
            value: { tableId: 42 } as any,
            result: result as any,
            taskId: 4,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls[0][0]).toMatchObject({ type: UPDATE_SCHEDULER_TASK, value: [task, expect.objectContaining({ status: TaskStatus.TASK_RUNNING })] });
        expect(calls[1][0]).toEqual({ type: SYSTEM_COLUMN_COMPUTATION_SUCCEEDED, value: [42, mockTable, mockDataFrame, mockColGroups] });
        expect(calls[2][0]).toEqual({ type: UNREGISTER_SCHEDULER_TASK, value: task });
        await expect(result.getValue()).resolves.toEqual([mockTable, mockDataFrame, mockColGroups]);
    });

    it('processes COLUMN_AGGREGATION_TASK successfully', async () => {
        const mockColumnAgg = { type: Symbol('ORDINAL_COLUMN'), value: { binCount: 10 } } as any;
        vi.mocked(computationLogic.computeColumnAggregates).mockResolvedValue(mockColumnAgg);

        const result = new AsyncValue<typeof mockColumnAgg, LoggableException>();
        const task: TaskVariant = {
            type: COLUMN_AGGREGATION_TASK,
            value: { tableId: 42, columnId: 7 } as any,
            result: result as any,
            taskId: 5,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls[0][0]).toMatchObject({ type: UPDATE_SCHEDULER_TASK, value: [task, expect.objectContaining({ status: TaskStatus.TASK_RUNNING })] });
        expect(calls[1][0]).toEqual({ type: COLUMN_AGGREGATION_SUCCEEDED, value: [42, 7, mockColumnAgg] });
        expect(calls[2][0]).toEqual({ type: UNREGISTER_SCHEDULER_TASK, value: task });
        await expect(result.getValue()).resolves.toBe(mockColumnAgg);
    });

    it('processes FILTERED_COLUMN_AGGREGATION_TASK successfully', async () => {
        vi.mocked(computationLogic.computeFilteredColumnAggregates).mockResolvedValue(null);

        const result = new AsyncValue<null, LoggableException>();
        const task: TaskVariant = {
            type: FILTERED_COLUMN_AGGREGATION_TASK,
            value: { tableId: 42, columnId: 7 } as any,
            result: result as any,
            taskId: 6,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls).toHaveLength(3);
        expect(calls[0][0]).toMatchObject({ type: UPDATE_SCHEDULER_TASK, value: [task, expect.objectContaining({ status: TaskStatus.TASK_RUNNING })] });
        expect(calls[1][0]).toEqual({ type: FILTERED_COLUMN_AGGREGATION_SUCCEEDED, value: [42, 7, null] });
        expect(calls[2][0]).toEqual({ type: UNREGISTER_SCHEDULER_TASK, value: task });
        await expect(result.getValue()).resolves.toBeNull();
    });

    it('marks task as failed and rejects when computation throws', async () => {
        const error = new Error('computation failed');
        vi.mocked(computationLogic.filterTable).mockRejectedValue(error);

        const result = new AsyncValue<any, any>();
        const task: TaskVariant = {
            type: TABLE_FILTERING_TASK,
            value: { tableId: 42 } as any,
            result: result as any,
            taskId: 10,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0][0]).toMatchObject({ type: UPDATE_SCHEDULER_TASK, value: [task, expect.objectContaining({ status: TaskStatus.TASK_RUNNING })] });
        expect(calls[1][0]).toMatchObject({
            type: UPDATE_SCHEDULER_TASK,
            value: [task, expect.objectContaining({
                status: TaskStatus.TASK_FAILED,
                failedWithError: expect.any(LoggableException),
            })],
        });
        await expect(result.getValue()).rejects.toBe(error);
    });

    it('preserves a LoggableException directly in failedWithError', async () => {
        const loggable = new LoggableException('specific error', { detail: 'info' }, 'test');
        vi.mocked(computationLogic.filterTable).mockRejectedValue(loggable);

        const result = new AsyncValue<any, any>();
        const task: TaskVariant = {
            type: TABLE_FILTERING_TASK,
            value: { tableId: 42 } as any,
            result: result as any,
            taskId: 11,
        };

        await processTask(task, dispatch, logger);

        const calls = (dispatch as ReturnType<typeof vi.fn>).mock.calls;
        const failedProgress = calls[1][0].value[1];
        expect(failedProgress.failedWithError).toBe(loggable);
        await expect(result.getValue()).rejects.toBe(loggable);
    });
});
