import * as React from 'react';
import * as arrow from 'apache-arrow';

import { AsyncDataFrame } from './compute_worker_bindings.js';
import { AsyncValue } from '../utils/async_value.js';
import { COLUMN_AGGREGATION_SUCCEEDED, ComputationAction, UNREGISTER_SCHEDULER_TASK, FILTERED_COLUMN_AGGREGATION_SUCCEEDED, SYSTEM_COLUMN_COMPUTATION_SUCCEEDED, TABLE_AGGREGATION_SUCCEEDED, TABLE_FILTERING_SUCCEEDED, TABLE_ORDERING_SUCCEDED, UPDATE_SCHEDULER_TASK } from './computation_state.js';
import { Dispatch, VariantKind } from '../utils/variant.js';
import { LoggableException, Logger } from '../platform/logger.js';
import { TaskStatus, TableFilteringTask, TableOrderingTask, TableAggregationTask, FilterTable, OrderedTable, TableAggregation, ColumnGroup, SystemColumnComputationTask, ColumnAggregationTask, ColumnAggregationVariant, TaskProgress, WithFilter, WithFilterEpoch } from "./computation_types.js";
import { computeColumnAggregates, computeFilteredColumnAggregates, computeSystemColumns, computeTableAggregates, filterTable, sortTable } from './computation_logic.js';
import { useComputationRegistry } from "./computation_registry.js";
import { useLogger } from '../platform/logger_provider.js';

const LOG_CTX = 'scheduler';


export type ComputationTask<Type, Task, Result> = VariantKind<Type, Task> & {
    result: AsyncValue<Result, LoggableException>,
    taskId?: number,
};

export const FILTERED_COLUMN_AGGREGATION_TASK = Symbol("FILTERED_COLUMN_AGGREGATION_TASK");
export const COLUMN_AGGREGATION_TASK = Symbol("COLUMN_AGGREGATION_TASK");
export const TABLE_FILTERING_TASK = Symbol("TABLE_FILTERING_TASK");
export const TABLE_ORDERING_TASK = Symbol("TABLE_ORDERING_TASK");
export const TABLE_AGGREGATION_TASK = Symbol("TABLE_AGGREGATION_TASK");
export const SYSTEM_COLUMN_COMPUTATION_TASK = Symbol("SYSTEM_COLUMN_COMPUTATION_TASK");

export type TaskVariant =
    | ComputationTask<typeof TABLE_FILTERING_TASK, TableFilteringTask, FilterTable | null>
    | ComputationTask<typeof TABLE_ORDERING_TASK, TableOrderingTask, OrderedTable>
    | ComputationTask<typeof TABLE_AGGREGATION_TASK, TableAggregationTask, [TableAggregation, ColumnGroup[]]>
    | ComputationTask<typeof SYSTEM_COLUMN_COMPUTATION_TASK, SystemColumnComputationTask, [arrow.Table, AsyncDataFrame, ColumnGroup[]]>
    | ComputationTask<typeof COLUMN_AGGREGATION_TASK, ColumnAggregationTask, ColumnAggregationVariant>
    | ComputationTask<typeof FILTERED_COLUMN_AGGREGATION_TASK, WithFilter<ColumnAggregationTask>, WithFilterEpoch<ColumnAggregationVariant> | null>
    ;

interface SchedulerState {
    /// Started tasks
    launched: Set<number>
}

export function ComputationScheduler(props: React.PropsWithChildren<{}>) {
    const logger = useLogger();
    const [computationState, dispatchComputation] = useComputationRegistry();

    const schedulerState = React.useRef<SchedulerState>({ launched: new Set() });
    React.useEffect(() => {
        const launched = schedulerState.current.launched!;
        for (const [taskId, task] of Object.entries(computationState.schedulerTasks)) {
            const id = +taskId;
            // Already processed?
            if (launched.has(id)) {
                continue;
            }
            // Launch the task
            launched.add(id);

            // Process a task asynchronously
            processTask(task, dispatchComputation, logger);
        }
        // Cleanup tasks that are no longer in included in the background tasks
        for (const l of launched) {
            if (computationState.schedulerTasks[l] === undefined) {
                launched.delete(l);
            }
        }
    });

    return props.children;
}

async function processTask(task: TaskVariant, dispatchComputation: Dispatch<ComputationAction>, logger: Logger) {
    if (task.taskId === undefined) {
        logger.warn("task has no task id", {
            taskId: task.taskId,
            taskType: getTaskVariantName(task)
        }, LOG_CTX);
        return;
    }
    let progress: TaskProgress = {
        status: TaskStatus.TASK_RUNNING,
        startedAt: new Date(),
        completedAt: null,
        failedAt: null,
        failedWithError: null
    };
    try {
        // Mark the task as running
        dispatchComputation({
            type: UPDATE_SCHEDULER_TASK,
            value: [task, progress]
        });

        // Process task
        switch (task.type) {
            case TABLE_FILTERING_TASK: {
                // Filter the table
                const filter = await filterTable(task.value, logger);
                // Mark as succeeded
                dispatchComputation({
                    type: TABLE_FILTERING_SUCCEEDED,
                    value: [task.value.tableId, filter]
                });
                // Resolve the promise
                task.result.resolve(filter);
                break;
            }
            case TABLE_ORDERING_TASK: {
                // Sort the table
                const ordered = await sortTable(task.value, logger);
                // Mark as succeeded
                dispatchComputation({
                    type: TABLE_ORDERING_SUCCEDED,
                    value: [task.value.tableId, ordered]
                });
                // Resolve the promise
                task.result.resolve(ordered);
                break;
            }
            case TABLE_AGGREGATION_TASK: {
                // Aggregate the table
                const [tableAgg, colEntries] = await computeTableAggregates(task.value, logger);
                // Mark as succeeded
                dispatchComputation({
                    type: TABLE_AGGREGATION_SUCCEEDED,
                    value: [task.value.tableId, tableAgg]
                });
                // Resolve the promise
                task.result.resolve([tableAgg, colEntries]);
                break;
            }
            case SYSTEM_COLUMN_COMPUTATION_TASK: {
                // Compute the system columns
                const [table, dataFrame, columnGroups] = await computeSystemColumns(task.value, logger);
                // Mark as succeeded
                dispatchComputation({
                    type: SYSTEM_COLUMN_COMPUTATION_SUCCEEDED,
                    value: [task.value.tableId, table, dataFrame, columnGroups]
                });
                // Resolve the promise
                task.result.resolve([table, dataFrame, columnGroups]);
                break;
            }
            case COLUMN_AGGREGATION_TASK:
                // Compute column aggregates
                const columnAgg = await computeColumnAggregates(task.value, logger);
                // Mark as succeeded
                dispatchComputation({
                    type: COLUMN_AGGREGATION_SUCCEEDED,
                    value: [task.value.tableId, task.value.columnId, columnAgg]
                });
                // Resolve the task
                task.result.resolve(columnAgg);
                break;
            case FILTERED_COLUMN_AGGREGATION_TASK:
                // Filtered column aggregates
                const filteredColumnAgg = await computeFilteredColumnAggregates(task.value, logger);
                // Mark as succeeded
                dispatchComputation({
                    type: FILTERED_COLUMN_AGGREGATION_SUCCEEDED,
                    value: [task.value.tableId, task.value.columnId, filteredColumnAgg]
                });
                // Resolve the task
                task.result.resolve(filteredColumnAgg);
                break;
        }
    } catch (e: any) {
        let loggable: LoggableException = (e instanceof LoggableException)
            ? e
            : new LoggableException("task execution failed", { error: e.toString() }, LOG_CTX);

        // Mark the task as failed
        progress = {
            ...progress,
            status: TaskStatus.TASK_FAILED,
            failedAt: new Date(),
            failedWithError: loggable,
        }
        // Register as failed
        dispatchComputation({
            type: UPDATE_SCHEDULER_TASK,
            value: [task, progress]
        });
        // Reject for users
        task.result.reject(e);
        return;
    }

    // Remove the task from the scheduler
    dispatchComputation({
        type: UNREGISTER_SCHEDULER_TASK,
        value: task
    });
}

function getTaskVariantName(task: TaskVariant): string {
    switch (task.type) {
        case COLUMN_AGGREGATION_TASK:
            return "column_aggregation";
        case TABLE_FILTERING_TASK:
            return "table_filtering";
        case TABLE_ORDERING_TASK:
            return "table_ordering";
        case TABLE_AGGREGATION_TASK:
            return "table_aggregation";
        case SYSTEM_COLUMN_COMPUTATION_TASK:
            return "system_column";
        case FILTERED_COLUMN_AGGREGATION_TASK:
            return "filtered_column_aggregation"
    }
}
