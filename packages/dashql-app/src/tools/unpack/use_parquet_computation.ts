import * as React from 'react';

import { useRuntime } from '@akohn/dashql-react/hooks';
import { readParquetFile } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_read';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import type { ArchiveFile } from './unpack_archive.js';
import type { ParquetTableState } from './parquet_file_card.js';

/// The table of a Parquet file of an archive as a computation of the runtime, for the data table. The file is read
/// with the compute database of the runtime once `load` is set, and its computation is kept until the file goes, so
/// that a card that opens again shows it at once. The table shows no column plots, the analysis skips the column
/// aggregates.
export function useParquetComputation(file: ArchiveFile, load: boolean): ParquetTableState {
    const runtime = useRuntime();
    const [state, setState] = React.useState<ParquetTableState>({ status: 'idle' });
    React.useEffect(() => {
        if (!load) return;
        let current = true;
        let busy = true;
        let tableId: number | null = null;
        const release = () => {
            if (tableId != null) runtime.dispatch({ computation: tableId }, { kind: 'deleteComputation' });
            tableId = null;
        };
        setState({ status: 'loading' });
        void (async () => {
            try {
                const database = await runtime.computeDatabase.get();
                const table = await readParquetFile(database, await file.read());
                if (!current) return;
                tableId = runtime.allocateId();
                await runtime.analyzeTable(tableId, table, { columnAggregates: false });
                if (current) setState({ status: 'ready', tableId, rows: table.numRows, columns: table.numCols });
            } catch (error) {
                release();
                if (current) setState({ status: 'failed', error: stringifyError(error) });
            } finally {
                busy = false;
                // A computation that was analyzed after the file went
                if (!current) release();
            }
        })();
        return () => {
            current = false;
            // An analysis that runs releases its computation when it is done
            if (!busy) release();
        };
    }, [runtime, file, load]);
    return state;
}
