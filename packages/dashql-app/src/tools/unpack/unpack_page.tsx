import * as React from 'react';

import { Button, ButtonVariant } from '@akohn/dashql-react/components/button';
import { DataTable, TableColumnHeader } from '@akohn/dashql-react/components/data_table/data_table';
import { FileIcon, UploadIcon } from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { formatBytes } from '@akohn/dashql-react/format/format';
import { useComputation } from '@akohn/dashql-react/hooks';
import { useComputationModel } from '@akohn/dashql-react/models/computation_model';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { ParquetFileCard } from './parquet_file_card.js';
import { isParquetFile, openArchive, type ArchiveFile, type UnpackedArchive } from './unpack_archive.js';
import { useParquetComputation } from './use_parquet_computation.js';
import * as styles from './unpack_page.module.css';

/// The tallest a table of a card grows before it scrolls
const TABLE_MAX_HEIGHT = 480;

/// The table of a read Parquet file
function ParquetTable(props: { tableId: number }) {
    const model = useComputationModel(useComputation(props.tableId));
    if (model == null) return null;
    return (
        <DataTable
            model={model}
            debugMode={false}
            columnHeader={TableColumnHeader.OnlyColumnName}
            fitHeight
            maxHeight={TABLE_MAX_HEIGHT}
            compact
        />
    );
}

const renderTable = (tableId: number) => <ParquetTable tableId={tableId} />;

/// The card of a Parquet file. The file is read when the card first opens and stays read while the archive is shown.
function ParquetFileEntry(props: { file: ArchiveFile }) {
    const [expanded, setExpanded] = React.useState(false);
    const [opened, setOpened] = React.useState(false);
    const table = useParquetComputation(props.file, opened);
    const toggle = React.useCallback(() => {
        setExpanded(expanded => !expanded);
        setOpened(true);
    }, []);
    return <ParquetFileCard file={props.file} table={table} expanded={expanded} onToggle={toggle} renderTable={renderTable} />;
}

/// The files of an opened archive: a card for every Parquet file, the other entries in a list below
function ArchiveFiles(props: { archive: UnpackedArchive }) {
    const parquetFiles = props.archive.files.filter(isParquetFile);
    const otherFiles = props.archive.files.filter(file => !isParquetFile(file));
    return (
        <>
            <div className={styles.summary}>
                <FileIcon size={16} />
                <span className={styles.summary_name}>{props.archive.name}</span>
                <span className={styles.summary_detail}>
                    {formatBytes(props.archive.size)}, {parquetFiles.length} Parquet {parquetFiles.length === 1 ? 'file' : 'files'}
                </span>
            </div>
            {parquetFiles.length === 0 && (
                <div className={styles.notice} role="status">
                    The file holds no Parquet files. Only .dashql files of the current format, with a Parquet file per
                    table, can be unpacked.
                </div>
            )}
            <div className={styles.cards}>
                {parquetFiles.map(file => <ParquetFileEntry key={file.index} file={file} />)}
            </div>
            {otherFiles.length > 0 && (
                <div className={styles.others}>
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
        </>
    );
}

/// The unpack tool: drop a `.dashql` file and look into the tables of its Parquet files, see docs/design/tools.md
export function UnpackPage() {
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
                        <h1 className={styles.title}>Unpack</h1>
                        <div className={styles.subtitle}>What a .dashql file holds, a table per Parquet file</div>
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
