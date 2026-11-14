import { DataType, IntervalUnit, TimeUnit, type Field, type Table } from 'apache-arrow';

/// A value of a result as JSON has it. Values that JSON can't hold exactly are texts: decimals, bigints beyond the safe
/// integers, dates and times, NaN and the infinities.
export type CellValue = null | boolean | number | string | CellValue[] | { [key: string]: CellValue };

const NANOS_PER_UNIT: Record<TimeUnit, bigint> = {
    [TimeUnit.SECOND]: 1_000_000_000n,
    [TimeUnit.MILLISECOND]: 1_000_000n,
    [TimeUnit.MICROSECOND]: 1_000n,
    [TimeUnit.NANOSECOND]: 1n,
};

/// The value of a column in a row, the column by its position since names may repeat
export function readCell(table: Table, column: number, row: number): CellValue {
    const vector = table.getChildAt(column);
    if (vector == null) throw new Error(`no column ${column}`);
    return convert(vector.type, vector.get(row));
}

/// The SQL type of a column, as Hyper names it
export function sqlTypeName(field: Field): string {
    const hyperType = field.metadata.get('hyper:type');
    const maxLength = field.metadata.get('hyper:max_string_length');
    switch (hyperType) {
        case 'JSON':
            return 'json';
        case 'Oid':
            return 'oid';
        case 'Geography':
            return 'geography';
        case 'Char':
            return maxLength != null ? `char(${maxLength})` : 'char';
    }
    if (DataType.isUtf8(field.type) || DataType.isLargeUtf8(field.type)) {
        return maxLength != null ? `varchar(${maxLength})` : 'text';
    }
    return arrowTypeName(field.type);
}

function arrowTypeName(type: DataType): string {
    if (DataType.isBool(type)) return 'boolean';
    if (DataType.isInt(type)) {
        switch (type.bitWidth) {
            case 8:
            case 16:
                return 'smallint';
            case 32:
                return 'integer';
            default:
                return 'bigint';
        }
    }
    if (DataType.isFloat(type)) return type.precision === 1 ? 'real' : 'double precision';
    if (DataType.isDecimal(type)) return `numeric(${type.precision},${type.scale})`;
    if (DataType.isUtf8(type) || DataType.isLargeUtf8(type)) return 'text';
    if (DataType.isBinary(type) || DataType.isLargeBinary(type) || DataType.isFixedSizeBinary(type)) return 'bytea';
    if (DataType.isDate(type)) return 'date';
    if (DataType.isTime(type)) return 'time';
    if (DataType.isTimestamp(type)) return type.timezone != null ? 'timestamptz' : 'timestamp';
    if (DataType.isInterval(type) || DataType.isDuration(type)) return 'interval';
    if (DataType.isList(type) || DataType.isFixedSizeList(type) || DataType.isLargeList(type)) {
        return `${arrowTypeName(type.children[0].type)}[]`;
    }
    if (DataType.isStruct(type)) return 'record';
    if (DataType.isDictionary(type)) return arrowTypeName(type.dictionary);
    return String(type).toLowerCase();
}

function convert(type: DataType, value: unknown): CellValue {
    if (value == null) return null;
    if (DataType.isBool(type)) return Boolean(value);
    if (DataType.isInt(type)) return integer(value as number | bigint);
    if (DataType.isFloat(type)) return float(value as number);
    if (DataType.isDecimal(type)) return decimal(String(value), type.scale);
    if (DataType.isUtf8(type) || DataType.isLargeUtf8(type)) return String(value);
    if (DataType.isBinary(type) || DataType.isLargeBinary(type) || DataType.isFixedSizeBinary(type)) {
        return hex(value as Uint8Array);
    }
    if (DataType.isDate(type)) return date(value as number | Date);
    if (DataType.isTime(type)) return time(BigInt(value as number | bigint) * NANOS_PER_UNIT[type.unit as TimeUnit]);
    if (DataType.isTimestamp(type)) return timestamp(value as number, type.timezone != null);
    if (DataType.isInterval(type) && type.unit === IntervalUnit.MONTH_DAY_NANO) return interval(value as Int32Array);
    if (DataType.isList(type) || DataType.isFixedSizeList(type) || DataType.isLargeList(type)) {
        const elementType = type.children[0].type;
        return Array.from(value as Iterable<unknown>, element => convert(elementType, element));
    }
    if (DataType.isStruct(type)) {
        const row = value as Record<string, unknown>;
        return Object.fromEntries(type.children.map(child => [child.name, convert(child.type, row[child.name])]));
    }
    if (DataType.isDictionary(type)) return convert(type.dictionary, value);
    return String(value);
}

function integer(value: number | bigint): number | string {
    if (typeof value === 'number') return value;
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function float(value: number): number | string {
    return Number.isFinite(value) ? value : String(value);
}

/// A decimal from the digits of its unscaled value, e.g. 12345678 with scale 3 is 12345.678
function decimal(unscaled: string, scale: number): string {
    const negative = unscaled.startsWith('-');
    const digits = negative ? unscaled.slice(1) : unscaled;
    if (scale <= 0) return unscaled;
    const padded = digits.padStart(scale + 1, '0');
    const text = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
    return negative ? `-${text}` : text;
}

function hex(bytes: Uint8Array): string {
    let text = '\\x';
    for (const byte of bytes) text += byte.toString(16).padStart(2, '0');
    return text;
}

function date(value: number | Date): string {
    const milliseconds = value instanceof Date ? value.getTime() : value;
    return new Date(milliseconds).toISOString().slice(0, 10);
}

/// The fraction of a second without trailing zeros, empty for whole seconds
function fraction(nanos: bigint): string {
    if (nanos === 0n) return '';
    return `.${nanos.toString().padStart(9, '0').replace(/0+$/, '')}`;
}

function clock(nanos: bigint): string {
    const seconds = nanos / 1_000_000_000n;
    const h = seconds / 3600n;
    const m = (seconds / 60n) % 60n;
    const s = seconds % 60n;
    const two = (n: bigint) => n.toString().padStart(2, '0');
    return `${two(h)}:${two(m)}:${two(s)}${fraction(nanos % 1_000_000_000n)}`;
}

function time(nanos: bigint): string {
    return clock(nanos);
}

/// A timestamp from the milliseconds that apache-arrow returns, with the microseconds of Hyper
function timestamp(milliseconds: number, utc: boolean): string {
    const micros = BigInt(Math.round(milliseconds * 1000));
    let seconds = micros / 1_000_000n;
    let micro = micros % 1_000_000n;
    if (micro < 0n) {
        micro += 1_000_000n;
        seconds -= 1n;
    }
    const iso = new Date(Number(seconds) * 1000).toISOString();
    const text = `${iso.slice(0, 10)} ${iso.slice(11, 19)}${fraction(micro * 1000n)}`;
    return utc ? `${text}+00:00` : text;
}

/// An interval as Postgres prints it, e.g. 1 year 2 mons 3 days 04:05:06
function interval(value: Int32Array): string {
    const [months, days, nanosLow, nanosHigh] = value;
    const nanos = (BigInt(nanosHigh) << 32n) | BigInt(nanosLow >>> 0);
    const parts: string[] = [];
    const years = Math.trunc(months / 12);
    const restMonths = months % 12;
    if (years !== 0) parts.push(`${years} ${Math.abs(years) === 1 ? 'year' : 'years'}`);
    if (restMonths !== 0) parts.push(`${restMonths} ${Math.abs(restMonths) === 1 ? 'mon' : 'mons'}`);
    if (days !== 0) parts.push(`${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`);
    if (nanos !== 0n || parts.length === 0) {
        parts.push(nanos < 0n ? `-${clock(-nanos)}` : clock(nanos));
    }
    return parts.join(' ');
}

/// A value as text for a table: NULL for null, JSON for lists and records
export function cellText(value: CellValue): string {
    if (value === null) return 'NULL';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
