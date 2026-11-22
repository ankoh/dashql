import * as React from 'react';

import type { CsvFormat, CsvSchema } from '@akohn/csv-sniffer';
import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ProgressBar } from '@akohn/dashql-react/components/progress_bar';
import { AlertIcon, FileIcon, ScreenFullIcon, TableIcon, CpuIcon } from '@akohn/dashql-react/components/symbol_icon';
import { formatBytes } from '@akohn/dashql-react/format/format';
import * as styles from './csv_file_card.module.css';

/// The sample of a file as the card shows it
export type CsvSampleState =
    | { status: 'sampling' }
    | { status: 'failed'; error: string }
    | { status: 'sampled'; format: CsvFormat; schema: CsvSchema };

/// A Parquet file of the conversion
export interface CsvPartInfo {
    rows: number;
    bytes: number;
    /// The types of its columns in SQL
    types: string[];
}

/// The conversion of a file to Parquet as the card shows it
export type CsvConversionState =
    | { status: 'idle' }
    | { status: 'converting'; bytesRead: number; workers: number }
    | { status: 'failed'; error: string }
    | { status: 'converted'; parts: CsvPartInfo[]; milliseconds: number };

/// The table of a file in Hyper as the card shows it
export type CsvTableState =
    /// Not loaded yet
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'failed'; error: string }
    /// Read by Hyper and analyzed as a computation
    | { status: 'ready'; tableId: number; rows: number; columns: number };

/// "1 row" or "2 rows"
function count(n: number, noun: string): string {
    return `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;
}

/// A delimiter or a quote as a word if it is no visible character
function character(c: string | null): string {
    switch (c) {
        case null: return 'none';
        case '\t': return 'tab';
        case ' ': return 'space';
        default: return c;
    }
}

/// The facts of the format of a file: the encoding, the delimiter, the quote, the header and the preamble
function formatFacts(format: CsvFormat): string[] {
    const facts = [format.transcoded ? `${format.encoding}, decoded to UTF-8` : format.encoding];
    facts.push(`delimiter ${character(format.delimiter)}`, `quote ${character(format.quote)}`);
    facts.push(format.hasHeader ? 'header' : 'no header');
    if (format.preambleRows > 0) facts.push(`${count(format.preambleRows, 'line')} skipped before the data`);
    return facts;
}

/// The note of a column: how its dates are written and which values are NULL
function columnNote(column: CsvSchema['columns'][number]): string {
    const notes: string[] = [];
    if (column.datePattern != null) notes.push(column.datePattern);
    if (column.nullValues.length > 0) notes.push(`NULL: ${column.nullValues.map(v => v === '' ? '""' : v).join(', ')}`);
    return notes.join(', ');
}

/// The columns of a part whose types differ from the sample, as `name TYPE`
function widenedColumns(schema: CsvSchema, part: CsvPartInfo): string {
    return schema.columns
        .flatMap((column, i) => part.types[i] != null && part.types[i] !== column.type ? [`${column.name} ${part.types[i]}`] : [])
        .join(', ');
}

/// The speed of a conversion, in MiB per second
function throughput(bytes: number, milliseconds: number): string {
    return `${(bytes / 1048576 / Math.max(milliseconds / 1000, 0.001)).toFixed(0)} MiB/s`;
}

export interface CsvFileCardProps {
    file: { name: string; size: number };
    sample: CsvSampleState;
    conversion: CsvConversionState;
    table: CsvTableState;
    /// Convert the file to Parquet
    onConvert: () => void;
    /// Load the Parquet files into Hyper
    onLoad: () => void;
}

/// The card of a CSV file: its format and the schema of a sample with a preview of its first rows, the conversion to
/// Parquet files with temporary workers, and the button that loads them into Hyper
export function CsvFileCard({ file, sample, conversion, table, onConvert, onLoad }: CsvFileCardProps) {
    return (
        <section className={styles.card} aria-label={file.name}>
            <div className={styles.header}>
                <FileIcon size={16} className={styles.icon} />
                <span className={styles.name}>{file.name}</span>
                {conversion.status === 'converted' && (
                    <span className={styles.shape}>
                        {count(conversion.parts.reduce((rows, part) => rows + part.rows, 0), 'row')}
                    </span>
                )}
                <span className={styles.size}>{formatBytes(file.size)}</span>
            </div>
            <div className={styles.body}>
                {sample.status === 'sampling' && <div className={styles.waiting}>Sampling the file…</div>}
                {sample.status === 'failed' && <div className={styles.error} role="alert">{sample.error}</div>}
                {sample.status === 'sampled' && (
                    <CsvSampleView file={file} format={sample.format} schema={sample.schema} conversion={conversion} table={table} onConvert={onConvert} onLoad={onLoad} />
                )}
            </div>
        </section>
    );
}

interface CsvSampleViewProps {
    file: { name: string; size: number };
    format: CsvFormat;
    schema: CsvSchema;
    conversion: CsvConversionState;
    table: CsvTableState;
    onConvert: () => void;
    onLoad: () => void;
}

function CsvSampleView({ file, format, schema, conversion, table, onConvert, onLoad }: CsvSampleViewProps) {
    return (
        <>
            <ul className={styles.facts} aria-label="Format">
                {formatFacts(format).map(fact => <li key={fact}>{fact}</li>)}
            </ul>
            {schema.problems.map(problem => (
                <div key={problem} className={styles.problem} role="alert">
                    <AlertIcon size={16} />
                    <span>{problem}</span>
                </div>
            ))}
            <div className={styles.section_title}>Schema{schema.sampled && <span className={styles.section_note}> of a sample</span>}</div>
            <table className={styles.schema} aria-label="Schema">
                <thead>
                    <tr><th>Column</th><th>Type</th><th>NULL</th><th>Note</th></tr>
                </thead>
                <tbody>
                    {schema.columns.map(column => (
                        <tr key={column.name}>
                            <td className={styles.column_name}>{column.name}</td>
                            <td className={styles.column_type}>{column.type}</td>
                            <td className={styles.column_nulls}>{column.nulls.toLocaleString()}</td>
                            <td className={styles.column_note}>{columnNote(column)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className={styles.section_title}>Preview</div>
            <div className={styles.preview_scroll}>
                <table className={styles.preview} aria-label="Preview">
                    <thead>
                        <tr>
                            {schema.columns.map(column => (
                                <th key={column.name}>
                                    <div>{column.name}</div>
                                    <div className={styles.preview_type}>{column.type}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {schema.preview.map((row, i) => (
                            <tr key={i}>
                                {row.map((value, j) => value == null
                                    ? <td key={j} className={styles.null}>NULL</td>
                                    : <td key={j}>{value}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <CsvConversionView file={file} schema={schema} conversion={conversion} table={table} onConvert={onConvert} onLoad={onLoad} />
        </>
    );
}

interface CsvConversionViewProps {
    file: { size: number };
    schema: CsvSchema;
    conversion: CsvConversionState;
    table: CsvTableState;
    onConvert: () => void;
    onLoad: () => void;
}

/// The conversion: its button, its progress, and the Parquet files with the button that loads them into Hyper
function CsvConversionView({ file, schema, conversion, table, onConvert, onLoad }: CsvConversionViewProps) {
    switch (conversion.status) {
        case 'idle':
        case 'failed':
            return (
                <div className={styles.actions}>
                    {conversion.status === 'failed' && <div className={styles.error} role="alert">{conversion.error}</div>}
                    <Button variant={ButtonVariant.Primary} leadingVisual={CpuIcon} onClick={onConvert}>Convert to Parquet</Button>
                </div>
            );
        case 'converting':
            return (
                <div className={styles.converting}>
                    <ProgressBar progress={file.size === 0 ? 0 : (conversion.bytesRead / file.size) * 100} aria-label="Conversion" />
                    <span>
                        Converting with {count(conversion.workers, 'worker')}: {formatBytes(conversion.bytesRead)} of {formatBytes(file.size)}…
                    </span>
                </div>
            );
        case 'converted': {
            const bytes = conversion.parts.reduce((sum, part) => sum + part.bytes, 0);
            const loading = table.status === 'loading';
            return (
                <>
                    <div className={styles.section_title}>Parquet</div>
                    <div className={styles.summary} role="status">
                        {count(conversion.parts.length, 'file')}, {formatBytes(bytes)} in {(conversion.milliseconds / 1000).toFixed(2)} s
                        ({throughput(file.size, conversion.milliseconds)} of CSV)
                    </div>
                    <table className={styles.schema} aria-label="Parts">
                        <thead>
                            <tr><th>Part</th><th>Rows</th><th>Size</th><th>Other types</th></tr>
                        </thead>
                        <tbody>
                            {conversion.parts.map((part, i) => (
                                <tr key={i}>
                                    <td className={styles.column_name}>{i + 1}</td>
                                    <td className={styles.column_nulls}>{part.rows.toLocaleString()}</td>
                                    <td className={styles.column_nulls}>{formatBytes(part.bytes)}</td>
                                    <td className={styles.column_note}>{widenedColumns(schema, part)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {table.status !== 'ready' && (
                        <div className={styles.actions}>
                            {table.status === 'failed' && <div className={styles.error} role="alert">{table.error}</div>}
                            <Button variant={ButtonVariant.Primary} leadingVisual={TableIcon} disabled={loading} onClick={onLoad}>
                                {loading ? 'Loading into Hyper…' : 'Load into Hyper'}
                            </Button>
                        </div>
                    )}
                </>
            );
        }
    }
}

export interface CsvTableCardProps {
    fileName: string;
    table: { tableId: number; rows: number; columns: number };
    /// Open the full table in a card over the page
    onShowTable: () => void;
    /// The table, rendered in the body of the card
    renderTable: (tableId: number) => React.ReactNode;
}

/// The card of the table that Hyper read from the Parquet files
export function CsvTableCard({ fileName, table, onShowTable, renderTable }: CsvTableCardProps) {
    return (
        <section className={styles.card} aria-label={`Table of ${fileName}`}>
            <div className={styles.header}>
                <TableIcon size={16} className={styles.icon} />
                <span className={styles.name}>Table</span>
                <span className={styles.shape}>{count(table.rows, 'row')}, {count(table.columns, 'column')}</span>
                <IconButton
                    className={styles.show_table}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label={`Open the table of ${fileName}`}
                    description="Open the table"
                    onClick={onShowTable}
                >
                    <ScreenFullIcon size={16} />
                </IconButton>
            </div>
            <div className={styles.table}>{renderTable(table.tableId)}</div>
        </section>
    );
}
