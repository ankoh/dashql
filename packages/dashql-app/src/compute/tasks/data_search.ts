import { DataFrame, generateTableName } from '@ankoh/dashql-runtime/compute/data_frame';
import { DataSearchTask, DataSearchTable } from '@ankoh/dashql-runtime/compute/computation_types';
import { LoggableException, LoggerLike, stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { buildDataSearchSQL, DATA_SEARCH_ROW_FIELD } from '@ankoh/dashql-runtime/compute/sql/query_result_search_sql';
import { ComputeQueryExecution, executeDirectly } from '@ankoh/dashql-runtime/compute/computation_tasks';

const LOG_CTX = "compute";

export async function searchData(
    task: DataSearchTask,
    logger: LoggerLike,
    executeQuery: ComputeQueryExecution = executeDirectly,
): Promise<DataSearchTable> {
    const sql = buildDataSearchSQL(
        task.inputDataFrame.tableName,
        task.rowNumberColumnName,
        task.columns,
        task.pattern,
    );
    try {
        logger.info('Searching table data', {
            version: task.tableVersion.toString(),
            requestId: task.requestId.toString(),
        }, LOG_CTX);
        const tableName = generateTableName('__search');
        const dataFrame = await executeQuery(sql, clientContext => DataFrame.fromSQL(
            task.inputDataFrame.database,
            sql,
            tableName,
            task.abortController.signal,
            clientContext,
        ));
        try {
            const dataTable = await dataFrame.readTable({ orderBy: [{ field: DATA_SEARCH_ROW_FIELD }], abort: task.abortController.signal });
            return {
                inputRowNumberColumnName: task.rowNumberColumnName,
                dataTable,
                dataFrame,
                version: task.tableVersion,
                requestId: task.requestId,
            };
        } catch (error) {
            await dataFrame.destroy();
            throw error;
        }
    } catch (error) {
        if (error instanceof LoggableException) throw error;
        throw new LoggableException('Failed to search table data', { error: stringifyError(error) }, LOG_CTX);
    }
}
