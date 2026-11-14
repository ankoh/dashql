import * as arrow from 'apache-arrow';
import { Logger } from '../../platform/logger/logger.js';

/// Create a validity bitmap from Uint8Array storing null indicators
/// Returns [bitmap, nullCount]
function createValidityBitmap(n: number, isNull: Uint8Array): [Uint8Array, number] {
    const validityBytes = Math.max(1, ((n + 63) & ~63) >> 3);
    const bitmap = new Uint8Array(validityBytes).fill(255); // all valid initially
    let nullCount = 0;

    for (let i = 0; i < n; i++) {
        if (isNull[i]) {
            const byte = i >> 3;
            const bit = i & 7;
            bitmap[byte] &= ~(1 << bit); // clear bit = null
            nullCount++;
        }
    }
    return [bitmap, nullCount];
}

/// Create Arrow Data for boolean column
function createBoolData(type: arrow.Bool, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.Bool> {
    const n = values.length;
    tmpIsNull.fill(0);
    const byteLen = Math.max(1, (n + 7) >> 3);
    const buffer = new Uint8Array(byteLen);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            tmpIsNull[i] = 1;
        } else if (Boolean(v)) {
            buffer[i >> 3] |= (1 << (i & 7));
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for Int types
function createIntData<T extends arrow.Int>(type: T, values: any[], tmpIsNull: Uint8Array): arrow.Data<T> {
    const n = values.length;
    tmpIsNull.fill(0);
    const buffer = new type.ArrayType(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            tmpIsNull[i] = 1;
        } else {
            const num = Number(v);
            if (Number.isNaN(num)) {
                tmpIsNull[i] = 1;
            } else {
                buffer[i] = num;
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for Float types
function createFloatData<T extends arrow.Float>(type: T, values: any[], tmpIsNull: Uint8Array): arrow.Data<T> {
    const n = values.length;
    tmpIsNull.fill(0);
    const buffer = new type.ArrayType(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            tmpIsNull[i] = 1;
        } else {
            const num = Number(v);
            if (Number.isNaN(num)) {
                tmpIsNull[i] = 1;
            } else {
                buffer[i] = num;
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for Int64/BigInt types
function createInt64Data(type: arrow.Int64, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.Int64> {
    const n = values.length;
    tmpIsNull.fill(0);
    const buffer = new type.ArrayType(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            tmpIsNull[i] = 1;
        } else {
            try {
                buffer[i] = BigInt(v);
            } catch {
                tmpIsNull[i] = 1;
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for Decimal128
function createDecimalData(type: arrow.Decimal, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.Decimal> {
    const n = values.length;
    const stride = type.bitWidth / 32;
    const buffer = new Uint32Array(n * stride);
    tmpIsNull.fill(0);

    for (let i = 0; i < n; i++) {
        const value = values[i];
        if (value == null || value === '') {
            tmpIsNull[i] = 1;
            continue;
        }

        try {
            const text = String(value).trim();
            const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
            if (!match || (!match[2] && !match[3])) {
                tmpIsNull[i] = 1;
                continue;
            }

            const fraction = match[3] ?? '';
            if (fraction.length > type.scale) {
                tmpIsNull[i] = 1;
                continue;
            }
            const digits = `${match[2] || '0'}${fraction.padEnd(type.scale, '0')}`.replace(/^0+(?=\d)/, '');
            let unscaled = BigInt(digits || '0');
            if (match[1] === '-') unscaled = -unscaled;

            const maxValue = (1n << BigInt(type.bitWidth - 1)) - 1n;
            const minValue = -(1n << BigInt(type.bitWidth - 1));
            if (unscaled < minValue || unscaled > maxValue) {
                tmpIsNull[i] = 1;
                continue;
            }

            if (unscaled < 0) unscaled += 1n << BigInt(type.bitWidth);
            for (let word = 0; word < stride; word++) {
                buffer[i * stride + word] = Number(unscaled & 0xffffffffn);
                unscaled >>= 32n;
            }
        } catch {
            tmpIsNull[i] = 1;
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for DateDay (days since epoch as Int32)
function createDateDayData(type: arrow.DateDay, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.DateDay> {
    const n = values.length;
    tmpIsNull.fill(0);
    const buffer = new Int32Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            tmpIsNull[i] = 1;
        } else {
            const date = new Date(v);
            const ms = date.getTime();
            if (Number.isNaN(ms)) {
                tmpIsNull[i] = 1;
            } else {
                buffer[i] = Math.floor(ms / (24 * 60 * 60 * 1000));
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for DateMillisecond (ms since epoch as BigInt64)
function createDateMillisecondData(type: arrow.DateMillisecond, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.DateMillisecond> {
    const n = values.length;
    tmpIsNull.fill(0);
    const buffer = new BigInt64Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null || v === '') {
            tmpIsNull[i] = 1;
        } else {
            const date = new Date(v);
            const ms = date.getTime();
            if (Number.isNaN(ms)) {
                tmpIsNull[i] = 1;
            } else {
                buffer[i] = BigInt(ms);
            }
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for TimeMillisecond (ms since midnight as Int32)
function createTimeMillisecondData(type: arrow.TimeMillisecond, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.TimeMillisecond> {
    const n = values.length;
    tmpIsNull.fill(0);
    const buffer = new Int32Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            tmpIsNull[i] = 1;
        } else {
            // Parse time string "HH:MM:SS.sss"
            const parts = String(v).split(':');
            const hours = parseInt(parts[0], 10) || 0;
            const minutes = parseInt(parts[1], 10) || 0;
            const secondsParts = (parts[2] || '0').split('.');
            const seconds = parseInt(secondsParts[0], 10) || 0;
            const millis = parseInt((secondsParts[1] || '0').padEnd(3, '0').slice(0, 3), 10);
            buffer[i] = ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// A Trino timestamp: `2024-03-01 12:30:00.123`, with time zone followed by ` UTC`, ` +01:00` or ` Europe/Berlin`
const TRINO_TIMESTAMP_PATTERN = /^(-?\d+)-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?: ?(\S+))?$/;
/// A zone offset like `+01:00`
const ZONE_OFFSET_PATTERN = /^([+-])(\d{2}):?(\d{2})$/;
/// The zones that are UTC
const UTC_ZONES = new Set(['UTC', 'Z', 'GMT', 'Etc/UTC', 'Etc/GMT', 'UCT', 'Zulu', 'Universal']);

/// The milliseconds since epoch of a wall clock time in UTC, Date.UTC would move the years 0 to 99 to the 1900s
function utcMs(year: number, month: number, day: number, hours: number, minutes: number, seconds: number, ms: number): number {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hours, minutes, seconds, ms);
    return date.getTime();
}

/// The formatters of the wall clock in a named zone
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
/// The offsets of named zones by zone and minute, cleared when it grows too large
const zoneOffsets = new Map<string, number>();
const ZONE_OFFSET_CACHE_SIZE = 100_000;

/// The offset of a named zone at an instant: the wall clock in the zone minus the wall clock in UTC
function namedZoneOffsetMs(zone: string, instantMs: number): number {
    const minute = Math.floor(instantMs / 60_000);
    const key = `${zone}|${minute}`;
    const cached = zoneOffsets.get(key);
    if (cached !== undefined) return cached;

    let formatter = zoneFormatters.get(zone);
    if (formatter === undefined) {
        // Throws a RangeError for unknown zones
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: zone, hourCycle: 'h23', era: 'short',
            year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
        });
        zoneFormatters.set(zone, formatter);
    }
    const parts: Record<string, string> = {};
    for (const part of formatter.formatToParts(minute * 60_000)) parts[part.type] = part.value;
    const year = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
    const wall = utcMs(year, Number(parts.month), Number(parts.day), Number(parts.hour), Number(parts.minute), 0, 0);
    const offset = wall - minute * 60_000;

    if (zoneOffsets.size >= ZONE_OFFSET_CACHE_SIZE) zoneOffsets.clear();
    zoneOffsets.set(key, offset);
    return offset;
}

/// Parse a Trino timestamp to milliseconds since epoch, null if it is invalid.
/// A timestamp without time zone is a wall clock time and stays as is, one with a time zone is moved to UTC.
export function parseTrinoTimestampMs(text: string): number | null {
    const match = TRINO_TIMESTAMP_PATTERN.exec(text);
    if (match == null) return null;
    const fraction = (match[7] ?? '').padEnd(3, '0').slice(0, 3);
    const wall = utcMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]), Number(fraction));
    const zone = match[8];
    if (zone == null || UTC_ZONES.has(zone)) {
        return wall;
    }
    const offset = ZONE_OFFSET_PATTERN.exec(zone);
    if (offset != null) {
        const offsetMs = (Number(offset[2]) * 60 + Number(offset[3])) * 60_000;
        return offset[1] === '-' ? wall + offsetMs : wall - offsetMs;
    }
    try {
        // Guess the instant with the offset at the wall clock, then correct it with the offset at the guess
        const guess = wall - namedZoneOffsetMs(zone, wall);
        return wall - namedZoneOffsetMs(zone, guess);
    } catch {
        return null;
    }
}

/// Create Arrow Data for Timestamp types (ms since epoch as BigInt64)
function createTimestampData<T extends arrow.Timestamp>(type: T, values: any[], tmpIsNull: Uint8Array): arrow.Data<T> {
    const n = values.length;
    tmpIsNull.fill(0);
    const buffer = new BigInt64Array(n);

    for (let i = 0; i < n; i++) {
        const v = values[i];
        const ms = v == null || v === '' ? null : parseTrinoTimestampMs(String(v));
        if (ms == null || Number.isNaN(ms)) {
            tmpIsNull[i] = 1;
        } else {
            buffer[i] = BigInt(ms);
        }
    }

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, data: buffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

// Shared TextEncoder for string encoding
const textEncoder = new TextEncoder();

/// Create Arrow Data for Utf8 strings
function createUtf8Data(type: arrow.Utf8, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.Utf8> {
    const n = values.length;
    tmpIsNull.fill(0);
    const encodedValues = new Array<Uint8Array | null>(n);
    let totalBytes = 0;

    // First pass: encode strings and track nulls
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            tmpIsNull[i] = 1;
            encodedValues[i] = null;
        } else {
            const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
            const encoded = textEncoder.encode(str);
            encodedValues[i] = encoded;
            totalBytes += encoded.length;
        }
    }

    // Second pass: build offsets and data buffer
    const offsets = new Int32Array(n + 1);
    const dataBuffer = new Uint8Array(totalBytes);
    let offset = 0;

    for (let i = 0; i < n; i++) {
        offsets[i] = offset;
        const encoded = encodedValues[i];
        if (encoded != null) {
            dataBuffer.set(encoded, offset);
            offset += encoded.length;
        }
    }
    offsets[n] = offset;

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, valueOffsets: offsets, data: dataBuffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for Binary
function createBinaryData(type: arrow.Binary, values: any[], tmpIsNull: Uint8Array): arrow.Data<arrow.Binary> {
    const n = values.length;
    tmpIsNull.fill(0);
    const binaryValues = new Array<Uint8Array | null>(n);
    let totalBytes = 0;

    // First pass: decode binary values and track nulls
    for (let i = 0; i < n; i++) {
        const v = values[i];
        if (v == null) {
            tmpIsNull[i] = 1;
            binaryValues[i] = null;
        } else if (v instanceof Uint8Array) {
            binaryValues[i] = v;
            totalBytes += v.length;
        } else if (typeof v === 'string') {
            // Trino returns varbinary as base64
            const bytes = Uint8Array.from(atob(v), c => c.charCodeAt(0));
            binaryValues[i] = bytes;
            totalBytes += bytes.length;
        } else {
            tmpIsNull[i] = 1;
            binaryValues[i] = null;
        }
    }

    // Second pass: build offsets and data buffer
    const offsets = new Int32Array(n + 1);
    const dataBuffer = new Uint8Array(totalBytes);
    let offset = 0;

    for (let i = 0; i < n; i++) {
        offsets[i] = offset;
        const bytes = binaryValues[i];
        if (bytes != null) {
            dataBuffer.set(bytes, offset);
            offset += bytes.length;
        }
    }
    offsets[n] = offset;

    const [validityBitmap, nullCount] = createValidityBitmap(n, tmpIsNull);
    return arrow.makeData({ type, offset: 0, length: n, nullCount, valueOffsets: offsets, data: dataBuffer, nullBitmap: nullCount > 0 ? validityBitmap : undefined });
}

/// Create Arrow Data for a column based on its type.
/// Instances report the type family as typeId (Type.Int, Type.Date, Type.Time), never the flattened ids like
/// Type.Int32 or Type.DateDay, so we dispatch on the family and then on the bit width or the unit.
function createColumnData(field: arrow.Field, values: any[], tmpIsNull: Uint8Array): arrow.Data {
    const type = field.type;
    if (arrow.DataType.isBool(type)) {
        return createBoolData(type, values, tmpIsNull);
    }
    if (arrow.DataType.isInt(type)) {
        return type.bitWidth === 64
            ? createInt64Data(type as arrow.Int64, values, tmpIsNull)
            : createIntData(type, values, tmpIsNull);
    }
    if (arrow.DataType.isFloat(type)) {
        return createFloatData(type, values, tmpIsNull);
    }
    if (arrow.DataType.isDecimal(type)) {
        return createDecimalData(type, values, tmpIsNull);
    }
    if (arrow.DataType.isDate(type)) {
        return type.unit === arrow.DateUnit.DAY
            ? createDateDayData(type as arrow.DateDay, values, tmpIsNull)
            : createDateMillisecondData(type as arrow.DateMillisecond, values, tmpIsNull);
    }
    if (arrow.DataType.isTime(type) && type.unit === arrow.TimeUnit.MILLISECOND && type.bitWidth === 32) {
        return createTimeMillisecondData(type as arrow.TimeMillisecond, values, tmpIsNull);
    }
    if (arrow.DataType.isTimestamp(type)) {
        return createTimestampData(type, values, tmpIsNull);
    }
    if (arrow.DataType.isBinary(type)) {
        return createBinaryData(type, values, tmpIsNull);
    }
    // Utf8 and all other types (including complex types as JSON)
    return createUtf8Data(new arrow.Utf8(), values, tmpIsNull);
}

/// Translate any[] with a schema to an arrow batch
export function translateAnyRowsToArrowBatch(schema: arrow.Schema, rows: any[][], _logger: Logger): arrow.RecordBatch {
    const numRows = rows.length;
    const numCols = schema.fields.length;

    // Shared validity buffer reused across all columns
    const tmpIsNull = new Uint8Array(numRows);

    // Build column data directly
    const columnData: arrow.Data[] = [];


    for (let col = 0; col < numCols; col++) {
        const field = schema.fields[col];

        // Collect column values
        const values: any[] = [];
        for (let row = 0; row < numRows; row++) {
            values.push(rows[row][col]);
        }

        // Create Data for this column
        const data = createColumnData(field, values, tmpIsNull);
        columnData.push(data);
    }

    // Create struct and batch
    const structData = arrow.makeData({ type: new arrow.Struct(schema.fields), children: columnData, nullCount: 0 });
    return new arrow.RecordBatch(schema, structData);
}
