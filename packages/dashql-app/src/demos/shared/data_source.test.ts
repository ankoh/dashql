import { describe, expect, it } from 'vitest';

import { BASE64URL_CODEC } from '../../utils/base64.js';
import { parseHyperLinkText } from './data_source.js';

function linkData(payload: unknown): string {
    return BASE64URL_CODEC.encode(new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer);
}

describe('parseHyperLinkText', () => {
    it('reads the link of hyperd run --ui', () => {
        const data = linkData({ hyperLink: { endpoint: 'http://127.0.0.1:7484', token: 'secret' } });
        expect(parseHyperLinkText(`https://dashql.app/?data=${data}`)).toEqual({ endpoint: 'http://127.0.0.1:7484', token: 'secret' });
        expect(parseHyperLinkText(data)).toEqual({ endpoint: 'http://127.0.0.1:7484', token: 'secret' });
    });

    it('rejects plain http to another machine', () => {
        const data = linkData({ hyperLink: { endpoint: 'http://example.com:7484', token: 'secret' } });
        expect(parseHyperLinkText(`https://dashql.app/?data=${data}`)).toBeNull();
    });

    it('ignores text that is no link', () => {
        expect(parseHyperLinkText('http://127.0.0.1:7484')).toBeNull();
        expect(parseHyperLinkText('')).toBeNull();
    });
});
