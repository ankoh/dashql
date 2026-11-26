import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const mimeTypes = {
    '.br': 'application/octet-stream',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
};

// The headers of the Cloudflare Pages deployment, read from the _headers file of the bundle. A line without indentation
// is a URL pattern where `*` matches any characters, the indented `Name: value` lines below it are its headers. The
// headers of every matching rule apply, a header of several rules joins their values with a comma, as on Pages.
function readHeaderRules(file) {
    const rules = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
        if (!/^\s/.test(line)) {
            const pattern = line.trim().split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
            rules.push({ pattern: new RegExp(`^${pattern}$`), headers: [] });
            continue;
        }
        const separator = line.indexOf(':');
        if (separator < 0 || rules.length === 0) throw new Error(`_headers: cannot read the line "${line}"`);
        rules.at(-1).headers.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
    }
    return rules;
}

/// Serve a bundle of the app like Cloudflare Pages on a free port of 127.0.0.1. Resolves to its URL and a close function.
export async function serveBundle(bundle) {
    const root = resolve(bundle);
    const headerRules = readHeaderRules(join(root, '_headers'));
    const responseHeaders = (pathname, file, size) => {
        const matched = {};
        for (const rule of headerRules) {
            if (!rule.pattern.test(pathname)) continue;
            for (const [name, value] of rule.headers) {
                matched[name] = matched[name] == null ? value : `${matched[name]}, ${value}`;
            }
        }
        return { 'Content-Length': String(size), 'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream', ...matched };
    };
    // The URL of the test frame of a shard lists its files
    const server = createServer({ maxHeaderSize: 1024 * 1024 }, (request, response) => {
        const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
        // Pages serves the app for the routes of its router, since the bundle has no 404.html
        const relative = normalize(pathname === '/' || extname(pathname) === '' ? 'index.html' : pathname.slice(1));
        const file = resolve(join(root, relative));
        if (file !== root && !file.startsWith(`${root}${sep}`)) {
            response.writeHead(403).end('Forbidden');
            return;
        }
        try {
            const stat = statSync(file);
            if (!stat.isFile()) throw new Error('Not a file');
            response.writeHead(200, responseHeaders(pathname, file, stat.size));
            createReadStream(file).pipe(response);
        } catch {
            response.writeHead(404).end('Not found');
        }
    });
    await new Promise((resolveListening, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListening);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Static server did not bind a TCP port');
    const close = async () => {
        server.closeIdleConnections();
        server.closeAllConnections();
        await new Promise(resolveClosed => server.close(resolveClosed));
    };
    return { url: `http://127.0.0.1:${address.port}`, close };
}
