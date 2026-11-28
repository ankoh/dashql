import { describe, expect, it } from 'vitest';

import { resizeContentForKeyboard } from './viewport_keyboard.js';

/// A document with the viewport meta of the app
function page(): Document {
    const doc = document.implementation.createHTMLDocument('app');
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1.0';
    doc.head.appendChild(meta);
    return doc;
}
const viewport = (doc: Document) => doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content;

describe('resizeContentForKeyboard', () => {
    it('lets the keyboard resize the content in Chromium and Firefox, once', () => {
        const chromium = page();
        resizeContentForKeyboard(chromium, { userAgentData: {}, userAgent: 'Mozilla/5.0 Chrome/140' } as unknown as Navigator);
        resizeContentForKeyboard(chromium, { userAgentData: {}, userAgent: 'Mozilla/5.0 Chrome/140' } as unknown as Navigator);
        expect(viewport(chromium)).toBe('width=device-width, initial-scale=1.0, interactive-widget=resizes-content');
        const firefox = page();
        resizeContentForKeyboard(firefox, { userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/140.0' } as Navigator);
        expect(viewport(firefox)).toContain('interactive-widget=resizes-content');
    });

    it('leaves the viewport of WebKit alone, it logs an error for the key', () => {
        const webkit = page();
        resizeContentForKeyboard(webkit, { userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15' } as Navigator);
        expect(viewport(webkit)).toBe('width=device-width, initial-scale=1.0');
    });
});
