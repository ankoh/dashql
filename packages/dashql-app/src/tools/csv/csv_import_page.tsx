import * as React from 'react';

import type { CsvConversion, CsvSample } from '@akohn/csv-sniffer';
import { Button, ButtonVariant } from '@akohn/dashql-react/components/button';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { TableDetails } from '@akohn/dashql-react/components/query_result/query_result_details';
import { ResultTableOverlay } from '@akohn/dashql-react/components/query_result/result_table_overlay';
import { UploadIcon } from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { useComputation, useRuntime, useTableComputation } from '@akohn/dashql-react/hooks';
import { useComputationModel } from '@akohn/dashql-react/models/computation_model';
import { readParquetFiles } from '@akohn/dashql/platform/hyperdb/hyperdb_parquet_read';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { DataTableView } from '../../results/data_table_view.js';
import { CsvFileCard, CsvTableCard, type CsvConversionState, type CsvSampleState, type CsvTableState } from './csv_file_card.js';
import { loadCsvModule } from './csv_module.js';
import * as styles from './csv_import_page.module.css';

/// The table that Hyper read from the Parquet files, in the card of the table
function CsvTable(props: { tableId: number }) {
    const model = useComputationModel(useComputation(props.tableId));
    if (model == null) return null;
    return <DataTableView model={model} columnHeader={TableColumnHeader.OnlyColumnName} fillHeight compact />;
}

/// The full table in a card over the page, like the result table of a feed entry: the search, the cross filters and
/// the detail of a cell
function CsvTableOverlay(props: { fileName: string; tableId: number; onClose: () => void }) {
    const model = useComputationModel(useComputation(props.tableId));
    return (
        <ResultTableOverlay scriptName={props.fileName} subject="Table" onClose={props.onClose}>
            {layout => (
                <TableDetails
                    title="Table"
                    computation={model}
                    fitHeight={layout.fitHeight}
                    maxHeight={layout.maxHeight}
                    table={tableLayout => model != null && (
                        <div className={classNames(styles.details_table, tableLayout.fitHeight && styles.details_table_fit_height)}>
                            <DataTableView
                                model={model}
                                columnHeader={TableColumnHeader.OnlyColumnName}
                                fitHeight={tableLayout.fitHeight}
                                maxHeight={tableLayout.maxHeight}
                                compact
                            />
                        </div>
                    )}
                />
            )}
        </ResultTableOverlay>
    );
}

/// A dropped file: its sample, its conversion to Parquet files and their table in Hyper. Another file gets an entry of
/// its own: the work of this one stops, its Parquet files and its computation go.
function CsvFileEntry(props: { file: File }) {
    const { file } = props;
    const runtime = useRuntime();
    const [sampleState, setSampleState] = React.useState<CsvSampleState>({ status: 'sampling' });
    const [sample, setSample] = React.useState<CsvSample | null>(null);
    const [conversionState, setConversionState] = React.useState<CsvConversionState>({ status: 'idle' });
    const [conversion, setConversion] = React.useState<CsvConversion | null>(null);
    const [loadRequested, setLoadRequested] = React.useState(false);
    const [tableShown, setTableShown] = React.useState(false);
    // The conversion that runs, stopped when the entry goes
    const converting = React.useRef<AbortController | null>(null);

    React.useEffect(() => {
        const controller = new AbortController();
        let result: CsvSample | null = null;
        void (async () => {
            try {
                const sniffer = await loadCsvModule();
                result = await sniffer.sample(file, { signal: controller.signal });
                if (controller.signal.aborted) {
                    result.release();
                    return;
                }
                setSample(result);
                setSampleState({ status: 'sampled', format: result.format, schema: result.schema });
            } catch (e) {
                if (!controller.signal.aborted) setSampleState({ status: 'failed', error: `${file.name} can't be read as CSV: ${stringifyError(e)}` });
            }
        })();
        return () => {
            controller.abort();
            result?.release();
        };
    }, [file]);

    // The Parquet files go with the entry
    React.useEffect(() => () => {
        converting.current?.abort();
        void conversion?.remove();
    }, [conversion]);

    const onConvert = React.useCallback(() => {
        if (sample == null) return;
        const controller = new AbortController();
        converting.current = controller;
        void (async () => {
            try {
                const sniffer = await loadCsvModule();
                let workers = 1;
                setConversionState({ status: 'converting', bytesRead: 0, workers });
                const result = await sniffer.convert(sample, {
                    signal: controller.signal,
                    onPlan: tasks => { workers = tasks.length; },
                    onProgress: bytesRead => {
                        if (!controller.signal.aborted) setConversionState({ status: 'converting', bytesRead, workers });
                    },
                });
                if (controller.signal.aborted) {
                    await result.remove();
                    return;
                }
                setConversion(result);
                setConversionState({
                    status: 'converted',
                    parts: result.parts.map(part => ({ rows: part.rows, bytes: part.file.size, types: part.types })),
                    milliseconds: result.milliseconds,
                });
            } catch (e) {
                if (!controller.signal.aborted) setConversionState({ status: 'failed', error: `The conversion failed: ${stringifyError(e)}` });
            }
        })();
    }, [sample]);

    const load = React.useCallback(async () => {
        if (conversion == null) throw new Error('the file is not converted');
        const files = conversion.parts.map(part => part.file);
        return readParquetFiles(await runtime.computeDatabase.get(), files, paths => conversion.unionQuery(paths));
    }, [runtime, conversion]);
    const computation = useTableComputation(loadRequested && conversion != null ? load : null);
    const table: CsvTableState = computation.status === 'ready'
        ? { status: 'ready', tableId: computation.tableId, rows: computation.table.numRows, columns: computation.table.numCols }
        : computation;
    const onLoad = React.useCallback(() => setLoadRequested(true), []);
    const showTable = React.useCallback(() => setTableShown(true), []);
    const closeTable = React.useCallback(() => setTableShown(false), []);
    const renderTable = React.useCallback((tableId: number) => <CsvTable tableId={tableId} />, []);
    return (
        <>
            <CsvFileCard file={file} sample={sampleState} conversion={conversionState} table={table} onConvert={onConvert} onLoad={onLoad} />
            {table.status === 'ready' && (
                <CsvTableCard fileName={file.name} table={table} onShowTable={showTable} renderTable={renderTable} />
            )}
            {tableShown && table.status === 'ready' && (
                <CsvTableOverlay fileName={file.name} tableId={table.tableId} onClose={closeTable} />
            )}
        </>
    );
}

/// The CSV import tool: drop a CSV file, look at the schema of a sample, convert the file to Parquet files with
/// temporary workers and load them into Hyper, see docs/design/tools.md
export function CsvImportPage() {
    const [file, setFile] = React.useState<File | null>(null);
    // Every opened file gets an entry of its own, also a file that is opened again
    const [generation, setGeneration] = React.useState(0);
    const [dragging, setDragging] = React.useState(false);
    const input = React.useRef<HTMLInputElement>(null);

    const open = React.useCallback((opened: File) => {
        setFile(opened);
        setGeneration(generation => generation + 1);
    }, []);

    // A file dropped next to the page doesn't replace it
    React.useEffect(() => {
        const ignore = (event: DragEvent) => event.preventDefault();
        window.addEventListener('dragover', ignore);
        window.addEventListener('drop', ignore);
        return () => {
            window.removeEventListener('dragover', ignore);
            window.removeEventListener('drop', ignore);
        };
    }, []);

    const onDragOver = (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDragging(true);
    };
    const onDragLeave = (event: React.DragEvent) => {
        // Only leaving the page counts, not moving between its children
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setDragging(false);
    };
    const onDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files[0];
        if (dropped != null) open(dropped);
    };
    const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files?.[0];
        event.target.value = '';
        if (picked != null) open(picked);
    };

    return (
        <main
            className={classNames(styles.page, dragging && styles.page_dragging)}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <div className={styles.content}>
                <header className={styles.header}>
                    <div>
                        <h1 className={styles.title}>CSV Import</h1>
                        <div className={styles.subtitle}>Sample a CSV file, convert it to Parquet with workers and read it with Hyper</div>
                    </div>
                    <Button variant={ButtonVariant.Default} leadingVisual={UploadIcon} onClick={() => input.current?.click()}>
                        Open File
                    </Button>
                    <input
                        ref={input}
                        className={styles.input}
                        type="file"
                        accept=".csv,.tsv,.txt,.psv,text/csv,text/tab-separated-values,text/plain"
                        aria-label="Open a CSV file"
                        onChange={onPick}
                    />
                </header>
                {file != null ? <CsvFileEntry key={generation} file={file} /> : (
                    <button type="button" className={styles.dropzone} onClick={() => input.current?.click()}>
                        <UploadIcon size={24} />
                        <span>Drop a CSV file here, or click to choose one</span>
                    </button>
                )}
            </div>
        </main>
    );
}
