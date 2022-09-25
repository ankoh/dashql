export type SQLValue = Int32Value | Utf8Value;

interface Int32Value {
    t: 'Int32';
    v: number | null;
}

interface Utf8Value {
    t: 'Utf8';
    v: string | null;
}
