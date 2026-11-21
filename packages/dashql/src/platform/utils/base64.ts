// Base64 of bytes over atob and btoa of the platform, and Base64URL without padding (RFC 4648)

/// The base64 of bytes
export function toBase64(bytes: Uint8Array): string {
    // String.fromCharCode takes its arguments on the stack, the bytes go in chunks
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}

/// The bytes of a text of base64
export function fromBase64(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; ++i) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/// Base64URL without padding, e.g. of the data of links
export const BASE64URL_CODEC = {
    encode(buffer: ArrayBuffer): string {
        return toBase64(new Uint8Array(buffer)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    /// Holds the text only characters of Base64URL? Padding is none of them.
    isValidBase64(text: string): boolean {
        return /^[A-Za-z0-9_-]*$/.test(text);
    },
    decode(text: string): ArrayBuffer {
        // A single character of a last group holds no whole byte, it is dropped
        const groups = text.length % 4 === 1 ? text.slice(0, -1) : text;
        const base64 = groups.replace(/-/g, '+').replace(/_/g, '/');
        return fromBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')).buffer as ArrayBuffer;
    },
};
