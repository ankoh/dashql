import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BASE64URL_CODEC } from '@akohn/dashql/platform/utils/base64';
import {
    buildShareUrl,
    decodeShareScript,
    encodeShareScript,
    MAX_SHARE_SCRIPT_BYTES,
    readShareScriptFromLocation,
} from './shell_share.js';

/// The raw deflate of bytes, a link that encodeShareScript did not make
async function deflate(bytes: Uint8Array): Promise<ArrayBuffer> {
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return await new Response(stream).arrayBuffer();
}

describe('Shell share encoding', () => {
    it('round-trips scripts through the URL payload', async () => {
        for (const script of ['select 1;', 'select \'grüße 🦆\';\nselect 2;', 'select 1;\n'.repeat(1000)]) {
            const payload = await encodeShareScript(script);
            expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
            await expect(decodeShareScript(payload)).resolves.toBe(script);
        }
    });

    it('compresses repetitive scripts', async () => {
        const script = 'select * from items where value > 1;\n'.repeat(100);
        expect((await encodeShareScript(script)).length).toBeLessThan(script.length / 10);
    });

    it('fails on scripts larger than a link shares', async () => {
        const largest = 'x'.repeat(MAX_SHARE_SCRIPT_BYTES);
        await expect(decodeShareScript(await encodeShareScript(largest))).resolves.toBe(largest);
        await expect(encodeShareScript(`${largest}x`)).rejects.toThrow('larger than 1 MiB');

        // A crafted link that inflates beyond the limit fails while it inflates
        const bomb = await deflate(new Uint8Array(64 * MAX_SHARE_SCRIPT_BYTES));
        expect(bomb.byteLength).toBeLessThan(MAX_SHARE_SCRIPT_BYTES);
        await expect(decodeShareScript(BASE64URL_CODEC.encode(bomb))).rejects.toThrow('shared script is larger than 1 MiB');
    });

    it('rejects payloads that are not encoded scripts', async () => {
        await expect(decodeShareScript('')).rejects.toThrow();
        await expect(decodeShareScript('not+base64url')).rejects.toThrow();
        await expect(decodeShareScript('AAAAAAAA')).rejects.toThrow();
    });
});

describe('Shell share URL', () => {
    let previousUrl: string;

    beforeEach(() => {
        previousUrl = window.location.href;
    });

    afterEach(() => {
        window.history.replaceState(window.history.state, '', previousUrl);
    });

    it('puts the payload into the hash of the current page', () => {
        expect(buildShareUrl('abc', { origin: 'https://hyperdb.sh', pathname: '/', search: '' })).toBe('https://hyperdb.sh/#script=abc');
        expect(buildShareUrl('abc', { origin: 'http://localhost:9002', pathname: '/shell.html', search: '?x=1' }))
            .toBe('http://localhost:9002/shell.html?x=1#script=abc');
    });

    it('reads the payload once and removes it from the address bar', () => {
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?keep=1#other=2&script=abc`);

        expect(readShareScriptFromLocation()).toBe('abc');
        expect(window.location.search).toBe('?keep=1');
        expect(window.location.hash).toBe('#other=2');
        expect(readShareScriptFromLocation()).toBeNull();
    });
});
