// SQL literals for the stores. hyperdb-wasm takes SQL text only, without parameters, so every value goes into the
// statement as a literal.

import { quoteLiteral } from '../src/quote.js';

/// Hyper refuses a literal of about 1 MiB (1,048,574 characters in 0.0.27361), longer texts are joined from parts.
/// A part has at most 2^17 UTF-16 code units: below the limit even when every one doubles as a quote or takes three
/// bytes in UTF-8.
const LITERAL_PART = 1 << 17;

function isHighSurrogate(code: number): boolean {
    return code >= 0xd800 && code <= 0xdbff;
}

function parts(value: string, size: number, keepSurrogates: boolean): string[] {
    const result: string[] = [];
    for (let begin = 0; begin < value.length; ) {
        let end = Math.min(begin + size, value.length);
        if (keepSurrogates && end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) end -= 1;
        result.push(value.slice(begin, end));
        begin = end;
    }
    return result;
}

/// A text literal, of any length
export function text(value: string): string {
    if (value.length <= LITERAL_PART) return quoteLiteral(value);
    return `(${parts(value, LITERAL_PART, true).map(quoteLiteral).join(' || ')})`;
}

/// A text literal or a typed null
export function nullableText(value: string | null | undefined): string {
    return value == null ? 'CAST(NULL AS text)' : text(value);
}

/// A JSON text with the keys of objects in order, to compare values structurally
export function canonical(value: unknown): string | undefined {
    return JSON.stringify(value, (_key, inner: unknown) => {
        if (inner == null || typeof inner !== 'object' || Array.isArray(inner)) return inner;
        return Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    });
}

/// A json literal of a value that JSON.stringify takes. Hyper keeps the text as it is, so JSON.parse of the stored
/// text returns an equal value.
export function json(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError(`JSON.stringify can't write a value of type ${typeof value}`);
    return `CAST(${text(serialized)} AS json)`;
}

/// A bigint literal
export function integer(value: number | bigint): string {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${value}`);
    return `CAST(${value.toString()} AS bigint)`;
}

/// A count for LIMIT and OFFSET, which take a plain integer literal and no cast
export function count(value: number): string {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`not a count: ${value}`);
    return String(value);
}

/// A timestamptz literal of milliseconds since the epoch
export function timestamp(milliseconds: number): string {
    return `CAST(${quoteLiteral(new Date(milliseconds).toISOString())} AS timestamptz)`;
}

/// A bytea literal, as base64 that Hyper decodes
export function bytes(value: Uint8Array): string {
    const base64 = Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
    // Parts of a multiple of 4 characters, the join of them is the base64 text again
    const literal = base64.length <= LITERAL_PART ? quoteLiteral(base64) : `(${parts(base64, LITERAL_PART, false).map(quoteLiteral).join(' || ')})`;
    return `decode(${literal}, 'base64')`;
}

/// A real[] literal, e.g. of an embedding
export function reals(values: readonly number[]): string {
    for (const value of values) if (!Number.isFinite(value)) throw new RangeError(`not a finite number: ${value}`);
    return `CAST(ARRAY[${values.join(',')}] AS real[])`;
}

/// The Number of a bigint, Int64 columns come as bigint
export function toNumber(value: unknown): number {
    return typeof value === 'bigint' ? Number(value) : (value as number);
}
