import { describe, expect, it } from 'vitest';

import { collectReferencedScripts, findScriptReferences } from './script_references.js';

describe('Script references', () => {
    const names = ['revenue', 'revenue-2', 'Top Customers'];

    it('finds the longest script name after the prefix', () => {
        expect(findScriptReferences(names, 'compare @revenue-2 with @REVENUE.')).toEqual([
            { from: 8, to: 18, name: 'revenue-2' },
            { from: 24, to: 32, name: 'revenue' },
        ]);
    });

    it('finds names with spaces', () => {
        expect(findScriptReferences(names, '@top customers by region')).toEqual([{ from: 0, to: 14, name: 'Top Customers' }]);
    });

    it('skips unknown names, longer words and email addresses', () => {
        expect(findScriptReferences(names, '@revenues @revenue_eu ann@revenue @ @orders')).toEqual([]);
    });

    it('collects every referenced script once', () => {
        expect(collectReferencedScripts(names, '@revenue-2, @revenue and @revenue again')).toEqual(['revenue-2', 'revenue']);
    });
});
