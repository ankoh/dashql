import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    buildShareUrl,
    decodeShareScript,
    encodeShareScript,
    readShareScriptFromLocation,
} from './shell_share.js';

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
