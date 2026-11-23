import { BASE64URL_CODEC } from '@akohn/dashql/platform/utils/base64';

/// The hash parameter carrying a shared script.
/// The hash never reaches the server and does not collide with the ?data= setup links of the app.
export const SHARE_SCRIPT_HASH_PARAMETER = 'script';

/// The largest script that a link shares, in UTF-8 bytes. A link inflates to at most this many bytes, a crafted link
/// can't make the page inflate gigabytes.
export const MAX_SHARE_SCRIPT_BYTES = 1024 * 1024;

/// Pipe bytes through a (de)compression stream, fail once the output exceeds `maxBytes`.
/// Reads the stream directly, Firefox logs corrupt input as console error when reading it through a Response.
async function pipeBytes(
    bytes: Uint8Array,
    transform: CompressionStream | DecompressionStream,
    maxBytes: number = Number.POSITIVE_INFINITY,
): Promise<ArrayBuffer> {
    const writer = transform.writable.getWriter();
    const written = writer.write(bytes as Uint8Array<ArrayBuffer>).then(() => writer.close());
    // A failed write also fails the read below, report the read error
    written.catch(() => {});
    const reader = transform.readable.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        length += chunk.value.byteLength;
        if (length > maxBytes) {
            const error = new Error(`shared script is larger than ${formatMiB(maxBytes)}`);
            // Stop the stream, the rest of the input is not inflated
            await reader.cancel(error).catch(() => {});
            throw error;
        }
        chunks.push(chunk.value);
    }
    await written;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out.buffer;
}

function formatMiB(bytes: number): string {
    return `${bytes / (1024 * 1024)} MiB`;
}

/// Encode a script as base64url of its deflated UTF-8 bytes, a script larger than MAX_SHARE_SCRIPT_BYTES fails
export async function encodeShareScript(script: string): Promise<string> {
    const bytes = new TextEncoder().encode(script);
    if (bytes.byteLength > MAX_SHARE_SCRIPT_BYTES) {
        throw new Error(`script is larger than ${formatMiB(MAX_SHARE_SCRIPT_BYTES)}, the largest script a link shares`);
    }
    const deflated = await pipeBytes(bytes, new CompressionStream('deflate-raw'));
    return BASE64URL_CODEC.encode(deflated);
}

/// Decode a script encoded with encodeShareScript
export async function decodeShareScript(payload: string): Promise<string> {
    if (payload.length === 0 || !BASE64URL_CODEC.isValidBase64(payload)) {
        throw new Error('shared script is not valid base64url');
    }
    const deflated = new Uint8Array(BASE64URL_CODEC.decode(payload));
    const inflated = await pipeBytes(deflated, new DecompressionStream('deflate-raw'), MAX_SHARE_SCRIPT_BYTES);
    return new TextDecoder('utf-8', { fatal: true }).decode(inflated);
}

/// Build the URL that opens the shell with a shared script
export function buildShareUrl(payload: string, location: Pick<Location, 'origin' | 'pathname' | 'search'> = window.location): string {
    return `${location.origin}${location.pathname}${location.search}#${SHARE_SCRIPT_HASH_PARAMETER}=${payload}`;
}

/// Read a shared script payload from the hash of the current URL and remove it from the address bar
export function readShareScriptFromLocation(): string | null {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const payload = params.get(SHARE_SCRIPT_HASH_PARAMETER);
    if (payload == null) return null;
    params.delete(SHARE_SCRIPT_HASH_PARAMETER);
    const hash = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${hash.length > 0 ? `#${hash}` : ''}`);
    return payload;
}
