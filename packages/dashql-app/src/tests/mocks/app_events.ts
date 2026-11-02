import { BASE64URL_CODEC } from '../../utils/base64.js';

/// The base64url encoding of an app event that carries a session ZIP, under the legacy key `notebook`
export function encodeSessionAppEvent(zip: Uint8Array): string {
    const json = JSON.stringify({ notebook: BASE64URL_CODEC.encode(zip.buffer as ArrayBuffer) });
    return BASE64URL_CODEC.encode(new TextEncoder().encode(json).buffer as ArrayBuffer);
}
