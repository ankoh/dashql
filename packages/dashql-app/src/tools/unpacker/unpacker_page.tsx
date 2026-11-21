import * as React from 'react';

import { Button, ButtonVariant } from '@akohn/dashql-react/components/button';
import { TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { TableDetails } from '@akohn/dashql-react/components/query_result/query_result_details';
import { ResultTableOverlay } from '@akohn/dashql-react/components/query_result/result_table_overlay';
import { FileIcon, UploadIcon } from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { formatBytes } from '@akohn/dashql-react/format/format';
import { useComputation } from '@akohn/dashql-react/hooks';
import { useComputationModel } from '@akohn/dashql-react/models/computation_model';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { DataTableView } from '../../results/data_table_view.js';
import { ParquetFileCard } from './parquet_file_card.js';
import { isParquetFile, openArchive, type ArchiveFile, type UnpackedArchive } from './unpacker_archive.js';
import { useParquetComputation } from './use_parquet_computation.js';
import * as styles from './unpacker_page.module.css';

/// The rows of the preview of a card, like the preview of a result in the feed: the column names open the full table
const PREVIEW_ROWS = 8;

/// The preview of the table of a read Parquet file, the first rows in the height of `PREVIEW_ROWS`
function ParquetTablePreview(props: { tableId: number; onShowTable: () => void }) {
    const model = useComputationModel(useComputation(props.tableId));
    if (model == null) return null;
    return (
        <DataTableView
            model={model}
            columnHeader={TableColumnHeader.OnlyColumnName}
            maxRows={PREVIEW_ROWS}
            onShowTable={props.onShowTable}
            compact
        />
    );
}

/// The full table of a read Parquet file in a card over the page, like the result table of a feed entry: the search,
/// the cross filters and the detail of a cell
function ParquetTableOverlay(props: { fileName: string; tableId: number; onClose: () => void }) {
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

/// The card of a Parquet file. The file is read when the card first opens and stays read while the archive is shown.
function ParquetFileEntry(props: { file: ArchiveFile }) {
    const [expanded, setExpanded] = React.useState(false);
    const [opened, setOpened] = React.useState(false);
    const [tableShown, setTableShown] = React.useState(false);
    const table = useParquetComputation(props.file, opened);
    const toggle = React.useCallback(() => {
        setExpanded(expanded => !expanded);
        setOpened(true);
    }, []);
    const showTable = React.useCallback(() => setTableShown(true), []);
    const closeTable = React.useCallback(() => setTableShown(false), []);
    const renderTable = React.useCallback(
        (tableId: number) => <ParquetTablePreview tableId={tableId} onShowTable={showTable} />,
        [showTable],
    );
    return (
        <>
            <ParquetFileCard
                file={props.file}
                table={table}
                expanded={expanded}
                onToggle={toggle}
                onShowTable={showTable}
                renderTable={renderTable}
            />
            {tableShown && table.status === 'ready' && (
                <ParquetTableOverlay fileName={props.file.fileName} tableId={table.tableId} onClose={closeTable} />
            )}
        </>
    );
}

/// The files of an opened archive: a card of the archive, and below it, indented and joined to it by a line that turns
/// to each of them, a card for every Parquet file and the other entries in a list
function ArchiveFiles(props: { archive: UnpackedArchive }) {
    const parquetFiles = props.archive.files.filter(isParquetFile);
    const otherFiles = props.archive.files.filter(file => !isParquetFile(file));
    return (
        <div className={styles.archive}>
            <div className={styles.archive_card}>
                <FileIcon size={16} className={styles.archive_icon} />
                <span className={styles.archive_name}>{props.archive.name}</span>
                <span className={styles.archive_detail}>
                    {parquetFiles.length} Parquet {parquetFiles.length === 1 ? 'file' : 'files'}
                </span>
                <span className={styles.archive_size}>{formatBytes(props.archive.size)}</span>
            </div>
            <div className={styles.archive_entries} role="group" aria-label={`Entries of ${props.archive.name}`}>
                {parquetFiles.length === 0 && (
                    <div className={classNames(styles.entry, styles.notice)} role="status">
                        The file holds no Parquet files. Only .dashql files of the current format, with a Parquet file
                        per table, can be unpacked.
                    </div>
                )}
                {parquetFiles.map(file => (
                    <div key={file.index} className={styles.entry}>
                        <ParquetFileEntry file={file} />
                    </div>
                ))}
                {otherFiles.length > 0 && (
                    <div className={classNames(styles.entry, styles.others)}>
                        <div className={styles.others_title}>Other entries</div>
                        <ul className={styles.others_list}>
                            {otherFiles.map(file => (
                                <li key={file.index}>
                                    <span className={styles.others_name}>{file.fileName}</span>
                                    <span className={styles.others_size}>{formatBytes(file.uncompressedSize)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </div>
    );
}

/// The unpacker tool: drop a `.dashql` file and look into the tables of its Parquet files, see docs/design/tools.md
export function UnpackerPage() {
    const [archive, setArchive] = React.useState<UnpackedArchive | null>(null);
    // Every opened file gets cards of its own, also a file that is opened again
    const [generation, setGeneration] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);
    const [opening, setOpening] = React.useState(false);
    const [dragging, setDragging] = React.useState(false);
    const input = React.useRef<HTMLInputElement>(null);

    // The reader of an archive is closed when the archive goes
    React.useEffect(() => {
        if (archive == null) return;
        return () => { void archive.close(); };
    }, [archive]);

    const open = React.useCallback(async (file: File) => {
        setOpening(true);
        setError(null);
        try {
            const opened = await openArchive(file);
            setArchive(opened);
            setGeneration(generation => generation + 1);
        } catch (e) {
            setArchive(null);
            setError(`${file.name} is not a ZIP archive: ${stringifyError(e)}`);
        } finally {
            setOpening(false);
        }
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
        const file = event.dataTransfer.files[0];
        if (file != null) void open(file);
    };
    const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file != null) void open(file);
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
                        <h1 className={styles.title}>Unpacker</h1>
                        <div className={styles.subtitle}>Inspect the contents of .dashql files</div>
                    </div>
                    <Button
                        variant={ButtonVariant.Default}
                        leadingVisual={UploadIcon}
                        disabled={opening}
                        onClick={() => input.current?.click()}
                    >
                        Open File
                    </Button>
                    <input
                        ref={input}
                        className={styles.input}
                        type="file"
                        accept=".dashql,.zip"
                        aria-label="Open a .dashql file"
                        onChange={onPick}
                    />
                </header>
                {error != null && <div className={styles.error} role="alert">{error}</div>}
                {archive != null ? <ArchiveFiles key={generation} archive={archive} /> : (
                    <button type="button" className={styles.dropzone} disabled={opening} onClick={() => input.current?.click()}>
                        <UploadIcon size={24} />
                        <span>{opening ? 'Opening…' : 'Drop a .dashql file here, or click to choose one'}</span>
                    </button>
                )}
            </div>
        </main>
    );
}
