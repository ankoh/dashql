import { describe, expect, it } from 'vitest';

import { applyFlavorToDocument, resolveFlavor, selectFlavor, withFlavorParameter } from './flavor_resolution.js';
import { applyFlavorSettings, DASHQL_FLAVOR, SIDP_FLAVOR } from './flavors.js';

describe('App flavor resolution', () => {
    it('defaults to DashQL', () => {
        expect(resolveFlavor(null)).toEqual({ flavor: DASHQL_FLAVOR });
    });

    it('selects the requested flavor', () => {
        expect(resolveFlavor('sidp')).toEqual({ flavor: SIDP_FLAVOR });
        expect(resolveFlavor('sidb')).toEqual({ flavor: SIDP_FLAVOR });
        expect(resolveFlavor('dashql')).toEqual({ flavor: DASHQL_FLAVOR });
    });

    it('ignores unknown flavors', () => {
        expect(resolveFlavor('unknown')).toEqual({ flavor: DASHQL_FLAVOR, unknownId: 'unknown' });
    });

    it('lets the url flavor win over the flavor of the app settings', () => {
        expect(selectFlavor(null, undefined)).toBe(DASHQL_FLAVOR);
        expect(selectFlavor(null, 'sidp')).toBe(SIDP_FLAVOR);
        expect(selectFlavor(null, 'unknown')).toBe(DASHQL_FLAVOR);
        expect(selectFlavor(DASHQL_FLAVOR, 'sidp')).toBe(DASHQL_FLAVOR);
        expect(selectFlavor(SIDP_FLAVOR, 'dashql')).toBe(SIDP_FLAVOR);
    });

    it('adds the flavor parameter to urls that lost it', () => {
        expect(withFlavorParameter(new URL('https://dashql.app/sessions/a'), SIDP_FLAVOR)?.href)
            .toBe('https://dashql.app/sessions/a?flavor=sidp');
        expect(withFlavorParameter(new URL('https://dashql.app/sessions/a?data=x#h'), SIDP_FLAVOR)?.href)
            .toBe('https://dashql.app/sessions/a?data=x&flavor=sidp#h');
        expect(withFlavorParameter(new URL('https://dashql.app/?flavor=sidp'), SIDP_FLAVOR)).toBeNull();
        expect(withFlavorParameter(new URL('https://dashql.app/?flavor=sidb'), SIDP_FLAVOR)?.href)
            .toBe('https://dashql.app/?flavor=sidp');
        expect(withFlavorParameter(new URL('https://dashql.app/sessions/a'), DASHQL_FLAVOR)).toBeNull();
    });
});

describe('App flavor branding', () => {
    function createDocument(): Document {
        const doc = document.implementation.createHTMLDocument('DashQL');
        doc.head.innerHTML = `
            <link rel="apple-touch-icon" href="/static/favicons/dashql/apple-touch-icon.png" />
            <link rel="icon" type="image/png" sizes="32x32" href="/static/favicons/dashql/favicon-32x32.png" />
            <link rel="manifest" href="/static/favicons/dashql/site.webmanifest" />
            <link rel="mask-icon" href="/static/favicons/dashql/safari-pinned-tab.svg" />
            <link rel="shortcut icon" href="/static/favicons/dashql/favicon.ico" />
            <meta name="apple-mobile-web-app-title" content="DashQL" />
        `;
        return doc;
    }

    it('keeps the static favicons of the default flavor', () => {
        const doc = createDocument();
        applyFlavorToDocument(DASHQL_FLAVOR, doc);
        expect(doc.documentElement.dataset.flavor).toBe('dashql');
        expect(doc.title).toBe('DashQL');
        expect(doc.head.querySelectorAll('link').length).toBe(5);
    });

    it('replaces the favicons of a branded flavor', () => {
        const doc = createDocument();
        applyFlavorToDocument(SIDP_FLAVOR, doc);
        expect(doc.documentElement.dataset.flavor).toBe('sidp');
        expect(doc.title).toBe('SIDP');
        expect(doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('SIDP');
        const links = [...doc.head.querySelectorAll('link')].map(l => [l.rel, l.getAttribute('href')]);
        expect(links).toEqual([
            ['manifest', '/static/favicons/dashql/site.webmanifest'],
            ['icon', SIDP_FLAVOR.favicon!.href],
        ]);
    });

    it('restores the static favicons when switching back to the default flavor', () => {
        const doc = createDocument();
        const statics = [...doc.head.querySelectorAll('link')].map(l => [l.rel, l.getAttribute('href')]);
        applyFlavorToDocument(SIDP_FLAVOR, doc);
        applyFlavorToDocument(SIDP_FLAVOR, doc);
        expect(doc.head.querySelectorAll('link[rel="icon"]').length).toBe(1);
        applyFlavorToDocument(DASHQL_FLAVOR, doc);
        expect(doc.documentElement.dataset.flavor).toBe('dashql');
        expect(doc.title).toBe('DashQL');
        expect(doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe('DashQL');
        const links = [...doc.head.querySelectorAll('link')].map(l => [l.rel, l.getAttribute('href')]);
        expect(links).toEqual([statics[2], statics[0], statics[1], statics[3], statics[4]]);
    });

    it('layers flavor settings over the config settings', () => {
        expect(applyFlavorSettings({ enableTableColumnPlots: true }, DASHQL_FLAVOR)).toEqual({ enableTableColumnPlots: true });
        const flavor = { ...SIDP_FLAVOR, settings: { enableTableColumnPlots: false, keywordCase: 'upper' as const } };
        expect(applyFlavorSettings({ enableTableColumnPlots: true, pauseAfterAppSetup: false }, flavor)).toEqual({
            enableTableColumnPlots: false,
            pauseAfterAppSetup: false,
            keywordCase: 'upper',
        });
        expect(applyFlavorSettings(undefined, flavor)).toEqual({ enableTableColumnPlots: false, keywordCase: 'upper' });
    });
});
