import * as arrow from 'apache-arrow';
import * as styles from './arrow_formatter.module.css';
import { Int128, Decimal128 } from '../../utils/int128.js';
import { Logger } from '../../platform/logger.js';

const LOG_CTX = 'arrow_formatter';

/// Format a duration value to a human-readable string
function formatDuration(value: bigint, unit: arrow.TimeUnit): string {
    // Convert to milliseconds first
    let ms: bigint;
    switch (unit) {
        case arrow.TimeUnit.SECOND:
            ms = value * 1000n;
            break;
        case arrow.TimeUnit.MILLISECOND:
            ms = value;
            break;
        case arrow.TimeUnit.MICROSECOND:
            ms = value / 1000n;
            break;
        case arrow.TimeUnit.NANOSECOND:
            ms = value / 1000000n;
            break;
        default:
            ms = value;
    }

    const isNegative = ms < 0n;
    if (isNegative) ms = -ms;

    const totalSeconds = ms / 1000n;
    const milliseconds = ms % 1000n;
    const seconds = totalSeconds % 60n;
    const totalMinutes = totalSeconds / 60n;
    const minutes = totalMinutes % 60n;
    const totalHours = totalMinutes / 60n;
    const hours = totalHours % 24n;
    const days = totalHours / 24n;

    const parts: string[] = [];
    if (days > 0n) parts.push(`${days}d`);
    if (hours > 0n) parts.push(`${hours}h`);
    if (minutes > 0n) parts.push(`${minutes}m`);
    if (seconds > 0n || milliseconds > 0n) {
        if (milliseconds > 0n) {
            parts.push(`${seconds}.${milliseconds.toString().padStart(3, '0')}s`);
        } else {
            parts.push(`${seconds}s`);
        }
    }

    if (parts.length === 0) return '0s';
    return (isNegative ? '-' : '') + parts.join(' ');
}

/// Format a list/array value to a string representation
function formatList(vector: arrow.Vector): string {
    const values: string[] = [];
    const maxItems = 5; // Limit display to avoid very long strings

    for (let i = 0; i < Math.min(vector.length, maxItems); i++) {
        const val = vector.get(i);
        if (val === null) {
            values.push('null');
        } else if (typeof val === 'string') {
            values.push(`"${val}"`);
        } else if (typeof val === 'bigint') {
            values.push(val.toString());
        } else if (typeof val === 'number') {
            values.push(Number.isInteger(val) ? val.toString() : val.toFixed(4));
        } else if (val instanceof arrow.Vector) {
            values.push(formatList(val)); // Nested list
        } else {
            values.push(String(val));
        }
    }

    if (vector.length > maxItems) {
        values.push(`... +${vector.length - maxItems} more`);
    }

    return `[${values.join(', ')}]`;
}

/// Format binary data as hex string
function formatBinary(data: Uint8Array): string {
    if (data == null) return '';
    const maxBytes = 32; // Limit display length
    const bytes = data.slice(0, maxBytes);
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    if (data.length > maxBytes) {
        return `0x${hex}... (+${data.length - maxBytes} bytes)`;
    }
    return `0x${hex}`;
}

/// Format time value (time of day) to a string
function formatTime(value: number | bigint, unit: arrow.TimeUnit): string {
    let totalMs: number;
    if (typeof value === 'bigint') {
        switch (unit) {
            case arrow.TimeUnit.SECOND:
                totalMs = Number(value) * 1000;
                break;
            case arrow.TimeUnit.MILLISECOND:
                totalMs = Number(value);
                break;
            case arrow.TimeUnit.MICROSECOND:
                totalMs = Number(value / 1000n);
                break;
            case arrow.TimeUnit.NANOSECOND:
                totalMs = Number(value / 1000000n);
                break;
            default:
                totalMs = Number(value);
        }
    } else {
        switch (unit) {
            case arrow.TimeUnit.SECOND:
                totalMs = value * 1000;
                break;
            case arrow.TimeUnit.MILLISECOND:
                totalMs = value;
                break;
            case arrow.TimeUnit.MICROSECOND:
                totalMs = value / 1000;
                break;
            case arrow.TimeUnit.NANOSECOND:
                totalMs = value / 1000000;
                break;
            default:
                totalMs = value;
        }
    }

    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const ms = Math.floor(totalMs % 1000);

    if (ms > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/// Format a struct value to a string representation
function formatStruct(value: Map<string, any> | Record<string, any>): string {
    if (value == null) return '';
    const entries: string[] = [];
    const maxEntries = 5;
    let count = 0;

    const iterate = (key: string, val: any) => {
        if (count >= maxEntries) return;
        let formatted: string;
        if (val === null) {
            formatted = 'null';
        } else if (typeof val === 'string') {
            formatted = `"${val}"`;
        } else if (typeof val === 'number' || typeof val === 'bigint') {
            formatted = String(val);
        } else {
            formatted = String(val);
        }
        entries.push(`${key}: ${formatted}`);
        count++;
    };

    if (value instanceof Map) {
        for (const [key, val] of value) {
            iterate(key, val);
        }
        if (value.size > maxEntries) {
            entries.push(`... +${value.size - maxEntries} more`);
        }
    } else {
        const keys = Object.keys(value);
        for (const key of keys) {
            iterate(key, value[key]);
        }
        if (keys.length > maxEntries) {
            entries.push(`... +${keys.length - maxEntries} more`);
        }
    }

    return `{${entries.join(', ')}}`;
}

/// Format interval value
function formatInterval(value: any, typeId: arrow.Type): string {
    if (value == null) return '';

    // IntervalDayTime: { days, milliseconds }
    // IntervalYearMonth: months as Int32
    // IntervalMonthDayNano: { months, days, nanoseconds }

    if (typeof value === 'number') {
        // IntervalYearMonth - value is months
        const years = Math.floor(value / 12);
        const months = value % 12;
        const parts: string[] = [];
        if (years !== 0) parts.push(`${years}y`);
        if (months !== 0 || parts.length === 0) parts.push(`${months}mo`);
        return parts.join(' ');
    }

    if (typeof value === 'object') {
        const parts: string[] = [];
        if ('days' in value && value.days !== 0) {
            parts.push(`${value.days}d`);
        }
        if ('months' in value && value.months !== 0) {
            const years = Math.floor(value.months / 12);
            const months = value.months % 12;
            if (years !== 0) parts.push(`${years}y`);
            if (months !== 0) parts.push(`${months}mo`);
        }
        if ('milliseconds' in value && value.milliseconds !== 0) {
            parts.push(`${value.milliseconds}ms`);
        }
        if ('nanoseconds' in value) {
            const ns = BigInt(value.nanoseconds);
            if (ns !== 0n) {
                const ms = ns / 1000000n;
                if (ms !== 0n) {
                    parts.push(`${ms}ms`);
                } else {
                    parts.push(`${ns}ns`);
                }
            }
        }
        return parts.length > 0 ? parts.join(' ') : '0';
    }

    return String(value);
}

export interface ColumnLayoutInfo {
    /// The header width
    headerWidth: number;
    /// The average width of values
    valueAvgWidth: number;
    /// The max width of values
    valueMaxWidth: number;
}

export interface ArrowColumnFormatter {
    /// The the column name
    getColumnName(): string;
    /// The statistics about the column layout
    getLayoutInfo(): ColumnLayoutInfo;
    /// We maintain a row to batch mapping per table.
    /// Individual column formatter therefore don't have to worry about resolving the "correct" batch.
    /// It's provided as input.
    getValue(batch: number, row: number): (string | null);
}

export class ArrowTextColumnFormatter implements ArrowColumnFormatter {
    readonly logger: Logger;
    readonly columnId: number;
    readonly columnName: string;
    readonly batches: arrow.RecordBatch[];
    readonly batchValues: ((string | null)[] | null)[];
    readonly valueClassName: string;
    formattedRowCount: number;
    formattedLengthMax: number;
    formattedLengthSum: number;
    formatter: ((o: any) => (null | string));

    public constructor(
        logger: Logger,
        columnId: number,
        schema: arrow.Schema,
        batches: arrow.RecordBatch[]
    ) {
        this.logger = logger;
        this.columnId = columnId;
        this.columnName = schema.fields[columnId].name;
        this.valueClassName = styles.data_value_text;
        this.batches = batches;
        this.batchValues = Array.from({ length: batches.length }, () => null);
        this.formattedRowCount = 0;
        this.formattedLengthMax = 0;
        this.formattedLengthSum = 0;
        this.formatter = _ => "";

        // Setup the formatter
        switch (schema.fields[columnId].type.typeId) {
            case arrow.Type.Int:
            case arrow.Type.Int16:
            case arrow.Type.Int32:
            case arrow.Type.Int64:
            case arrow.Type.Float:
            case arrow.Type.Float16:
            case arrow.Type.Float32:
            case arrow.Type.Float64: {
                this.valueClassName = styles.data_value_number;
                const fmt = Intl.NumberFormat('en-US');
                this.formatter = (v: number) => (v == null ? null : fmt.format(v));
                break;
            }
            case arrow.Type.Decimal: {
                this.valueClassName = styles.data_value_number;
                const decimalType = schema.fields[columnId].type as arrow.Decimal;
                this.formatter = (v: any) => {
                    const i = Int128.decodeLE(v);
                    return Decimal128.format(i, decimalType.scale);
                }
                break;
            }
            case arrow.Type.Utf8:
            case arrow.Type.LargeUtf8:
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: string) => v || null;
                break;
            case arrow.Type.Bool: {
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: boolean) => (v == null ? null : v ? 'true' : 'false');
                break;
            }
            case arrow.Type.Null: {
                this.formatter = () => null;
                break;
            }
            case arrow.Type.Binary:
            case arrow.Type.LargeBinary:
            case arrow.Type.FixedSizeBinary: {
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: Uint8Array) => (v == null ? null : formatBinary(v));
                break;
            }
            case arrow.Type.Time:
            case arrow.Type.TimeSecond:
            case arrow.Type.TimeMillisecond:
            case arrow.Type.TimeMicrosecond:
            case arrow.Type.TimeNanosecond: {
                this.valueClassName = styles.data_value_text;
                const timeType = schema.fields[columnId].type as arrow.Time;
                this.formatter = (v: number | bigint) => (v == null ? null : formatTime(v, timeType.unit));
                break;
            }
            case arrow.Type.Timestamp:
            case arrow.Type.TimestampSecond:
            case arrow.Type.TimestampMillisecond:
            case arrow.Type.TimestampMicrosecond:
            case arrow.Type.TimestampNanosecond: {
                this.valueClassName = styles.data_value_text;
                const type = schema.fields[columnId].type as arrow.Timestamp;
                const fmt = Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'medium' });
                switch (type.unit) {
                    case arrow.TimeUnit.SECOND:
                        this.formatter = (v: number) => (v == null ? null : fmt.format(new Date(v * 1000)));
                        break;
                    case arrow.TimeUnit.MILLISECOND:
                        this.formatter = (v: number) => (v == null ? null : fmt.format(new Date(v)));
                        break;
                    case arrow.TimeUnit.MICROSECOND:
                        this.formatter = (v: number) => (v == null ? null : fmt.format(new Date(v / 1000)));
                        break;
                    case arrow.TimeUnit.NANOSECOND:
                        this.formatter = (v: number) => (v == null ? null : fmt.format(new Date(v / 1000 / 1000)));
                        break;
                }
                break;
            }
            case arrow.Type.DateMillisecond:
            case arrow.Type.DateDay:
            case arrow.Type.Date: {
                this.valueClassName = styles.data_value_text;
                const fmt = Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                });
                this.formatter = (v: number) => (v == null ? null : fmt.format(v));
                break;
            }
            case arrow.Type.Duration:
            case arrow.Type.DurationSecond:
            case arrow.Type.DurationMillisecond:
            case arrow.Type.DurationMicrosecond:
            case arrow.Type.DurationNanosecond: {
                this.valueClassName = styles.data_value_text;
                const durationType = schema.fields[columnId].type as arrow.Duration;
                this.formatter = (v: bigint) => {
                    if (v == null) return null;
                    return formatDuration(v, durationType.unit);
                };
                break;
            }
            case arrow.Type.List:
            case arrow.Type.FixedSizeList: {
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: arrow.Vector) => {
                    if (v == null) return null;
                    return formatList(v);
                };
                break;
            }
            case arrow.Type.Struct: {
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: any) => {
                    if (v == null) return null;
                    return formatStruct(v);
                };
                break;
            }
            case arrow.Type.Map: {
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: any) => {
                    if (v == null) return null;
                    return formatStruct(v);
                };
                break;
            }
            case arrow.Type.Interval:
            case arrow.Type.IntervalDayTime:
            case arrow.Type.IntervalYearMonth:
            case arrow.Type.IntervalMonthDayNano: {
                this.valueClassName = styles.data_value_text;
                const intervalType = schema.fields[columnId].type;
                this.formatter = (v: any) => {
                    if (v == null) return null;
                    return formatInterval(v, intervalType.typeId);
                };
                break;
            }
            case arrow.Type.Union:
            case arrow.Type.DenseUnion:
            case arrow.Type.SparseUnion: {
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: any) => {
                    if (v == null) return null;
                    if (typeof v === 'string') return v;
                    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
                    return JSON.stringify(v);
                };
                break;
            }
            case arrow.Type.Dictionary: {
                // Dictionary values are decoded to their actual values by Arrow
                this.valueClassName = styles.data_value_text;
                this.formatter = (v: any) => {
                    if (v == null) return null;
                    if (typeof v === 'string') return v;
                    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
                    return String(v);
                };
                break;
            }
            default:
                logger.warn("unsupport column type in Arrow text formatter", {
                    columnId: columnId.toString(),
                    typeId: schema.fields[columnId].type.toString(),
                    field: schema.fields[columnId].name.toString(),
                }, LOG_CTX);
                break;
        }
    }

    /// We do not eagerly format all columns.
    /// Instead, we just check lazily if a batch is loaded before resolving a value.
    public ensureBatchIsLoaded(index: number): (string | null)[] {
        if (this.batchValues[index] != null) {
            return this.batchValues[index]!;
        }
        const data = this.batches[index];
        const column = data.getChildAt(this.columnId)!;

        const values = [];
        let valueLengthSum = 0;
        let valueLengthMax = 0;
        for (const value of column) {
            if (value == null) {
                values.push(null);
            } else {
                const text = this.formatter(value) || '';
                values.push(text);
                valueLengthSum += text.length;
                valueLengthMax = Math.max(valueLengthMax, text.length);
            }
        }
        this.formattedLengthMax = Math.max(this.formattedLengthMax, valueLengthMax)
        this.formattedLengthSum += valueLengthSum;
        this.formattedRowCount += values.length;
        this.batchValues[index] = values;
        return values;
    }

    public getBatchValues(batch: number) {
        return this.ensureBatchIsLoaded(batch);
    }
    public getValue(batch: number, row: number): string | null {
        return this.getBatchValues(batch)[row];
    }
    public getColumnName(): string {
        return this.columnName;
    }
    public getLayoutInfo(): ColumnLayoutInfo {
        return {
            headerWidth: this.columnName.length,
            valueMaxWidth: this.formattedLengthMax,
            valueAvgWidth: this.formattedLengthSum / Math.max(this.formattedRowCount, 1),
        };
    }
}

export class ArrowTableFormatter {
    /// The formatters for the individual columns
    columns: ArrowColumnFormatter[];
    /// Stores the offsets of a batch
    batchOffsets: Uint32Array;
    /// Matches rows to batches
    rowIndex: Uint32Array;

    public constructor(schema: arrow.Schema, batches: arrow.RecordBatch[], logger: Logger) {
        // Resolve the starting offset for all batches
        const batchOffsets = new Uint32Array(batches.length);
        let numRows = 0;
        for (let i = 0; i < batches.length; ++i) {
            batchOffsets[i] = numRows;
            numRows += batches[i].numRows;
        }
        // Write for each row in which batch they are stored.
        // This is not cheap but gives us very fast access later.
        const rowIndex = new Uint32Array(numRows);
        let rowIndexWriter = 0;
        for (let i = 0; i < batches.length; ++i) {
            for (let j = 0; j < batches[i].numRows; ++j) {
                rowIndex[rowIndexWriter++] = i;
            }
        }
        const columns: ArrowColumnFormatter[] = [];
        for (let i = 0; i < schema.fields.length; ++i) {
            const renderer = new ArrowTextColumnFormatter(logger, i, schema, batches);
            columns.push(renderer);
        }
        this.columns = columns;
        this.batchOffsets = batchOffsets;
        this.rowIndex = rowIndex;
    }

    public getValue(row: number, column: number): (string | null) {
        const batch = this.rowIndex[row];
        const indexInBatch = row - this.batchOffsets[batch];
        return this.columns[column].getValue(batch, indexInBatch);
    }
}

export function dataTypeToString(t: arrow.DataType): string {
    switch (t.typeId) {
        case arrow.Type.Decimal: {
            const d = t as arrow.Decimal;
            return `Decimal(${d.precision},${d.scale})`;
        }
        case arrow.Type.Timestamp: {
            const ts = t as arrow.Timestamp;
            let unit = "";
            switch (ts.unit) {
                case arrow.TimeUnit.SECOND:
                    unit = "s";
                    break;
                case arrow.TimeUnit.MILLISECOND:
                    unit = "ms";
                    break;
                case arrow.TimeUnit.MICROSECOND:
                    unit = "us";
                    break;
                case arrow.TimeUnit.NANOSECOND:
                    unit = "ns";
                    break;
            }
            return `Timestamp(${unit})`;
        }
        case arrow.Type.Utf8:
            return `Text`;
        default:
            return t.toString();
    }
}
