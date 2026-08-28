import path from "node:path";

export const APP_ORIGIN = "app://bundle";

export const APP_RESPONSE_HEADERS = Object.freeze({
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": [
        "default-src 'self'",
        "connect-src 'self' app: data: dashql-native: http: https: ws: wss:",
        "font-src 'self' data:",
        "img-src 'self' data: blob: https:",
        "script-src 'self' 'wasm-unsafe-eval' blob:",
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self' blob:",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
});

const MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
});

export function resolveAppRequest(rendererRoot: string, requestUrl: string): string | null {
    let url: URL;
    try {
        url = new URL(requestUrl);
    } catch {
        return null;
    }
    if (url.protocol !== "app:" || url.hostname !== "bundle" || url.username || url.password || url.port) {
        return null;
    }

    let decodedPath: string;
    try {
        decodedPath = decodeURIComponent(url.pathname);
    } catch {
        return null;
    }
    if (decodedPath.includes("\0") || decodedPath.includes("\\")) {
        return null;
    }

    const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
    const root = path.resolve(rendererRoot);
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        return null;
    }
    return resolved;
}

export function contentTypeFor(filePath: string): string {
    if (/\.wasm(?:\.[^.]+)?\.br$/i.test(filePath)) {
        return "application/wasm";
    }
    return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function contentHeadersFor(filePath: string): Readonly<Record<string, string>> {
    return {
        "Content-Type": contentTypeFor(filePath),
    };
}

export function isBrotliWasm(filePath: string): boolean {
    return /\.wasm(?:\.[^.]+)?\.br$/i.test(filePath);
}
