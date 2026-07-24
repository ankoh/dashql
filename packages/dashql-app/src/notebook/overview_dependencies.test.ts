import { describe, it, expect, beforeAll, afterEach } from 'vitest';

import * as core from '../core/index.js';

import { analyzeScript } from '../view/editor/dashql_processor.js';
import { ScriptData, ScriptDataMap } from './notebook_state.js';
import { NotebookPage, NotebookPageScript, createPageScript, normalizePageName, scriptDisplayName } from './notebook_types.js';
import { computePageDependencies } from './overview_dependencies.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

interface BuiltPage {
    folderName: string;
    files: { fileName: string; text: string }[];
}

/// Build one or more pages that share a single catalog, so cross-page references resolve. Returns
/// the per-page {page, entries} plus the shared script map. Each script is registered under its
/// clean notebook path (folder/file), exactly as analyzeNotebookScript does.
function buildPages(pages: BuiltPage[]): {
    scripts: ScriptDataMap;
    pages: { page: NotebookPage; entries: NotebookPageScript[] }[];
} {
    const catalog = dql!.createCatalog();
    const scripts: ScriptDataMap = {};
    const built: { page: NotebookPage; entries: NotebookPageScript[] }[] = [];

    for (const { folderName, files } of pages) {
        const pageScripts: { [fileName: string]: NotebookPageScript } = {};
        const entries: NotebookPageScript[] = [];
        for (const { fileName, text } of files) {
            const script = dql!.createScript(catalog);
            const scriptKey = script.getCatalogEntryId();
            script.insertTextAt(0, text);
            script.setNotebookPath(`${normalizePageName(folderName)}/${scriptDisplayName(fileName)}`);
            const buffers = analyzeScript(script);
            catalog.loadScript(script, scriptKey);

            scripts[scriptKey] = {
                scriptKey,
                scriptAnalysis: { buffers, outdated: false },
                fileName,
                folderName,
            } as unknown as ScriptData;

            const pageScript = createPageScript(scriptKey, fileName);
            pageScripts[fileName] = pageScript;
            entries.push(pageScript);
        }
        built.push({ page: { folderName, scripts: pageScripts }, entries });
    }

    return { scripts, pages: built };
}

/// Convenience wrapper for the single-page tests.
function buildPage(
    folderName: string,
    files: { fileName: string; text: string }[],
): { page: NotebookPage; scripts: ScriptDataMap; entries: NotebookPageScript[] } {
    const { scripts, pages } = buildPages([{ folderName, files }]);
    return { page: pages[0].page, scripts, entries: pages[0].entries };
}

describe('computePageDependencies', () => {
    it('finds a plain-SQL FROM-clause reference into the notebook namespace', () => {
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_base.sql', text: 'select 1 as x' },
            { fileName: '2_derived.sql', text: 'select * from dashql.notebook."main/base"' },
        ]);

        const { intra, crossPage } = computePageDependencies(entries, scripts, page);
        expect(intra).toHaveLength(1);
        expect(intra[0].fromFeedIndex).toBe(1); // the derived (dependent) entry
        expect(intra[0].toFeedIndex).toBe(0); // the base (source) entry
        expect(intra[0].from).toBe(entries[1].scriptId);
        expect(intra[0].to).toBe(entries[0].scriptId);
        expect(crossPage).toHaveLength(0);
    });

    it('finds a VISUALIZE script reference', () => {
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_base.sql', text: 'select 1 as x, 2 as y' },
            { fileName: '2_chart.sql', text: 'VISUALIZE dashql.notebook."main/base" USING vegalite (mark => bar)' },
        ]);

        const { intra } = computePageDependencies(entries, scripts, page);
        expect(intra.some(d => d.from === entries[1].scriptId && d.to === entries[0].scriptId)).toBe(true);
    });

    it('drops forward references (only backward edges are kept)', () => {
        // The first entry references the second (a forward ref) — must be dropped so the edge set
        // stays a feed-order DAG.
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_a.sql', text: 'select * from dashql.notebook."main/b"' },
            { fileName: '2_b.sql', text: 'select 1 as x' },
        ]);

        const { intra } = computePageDependencies(entries, scripts, page);
        expect(intra).toHaveLength(0);
    });

    it('attributes a resolved reference into another page as a cross-page edge', () => {
        const { scripts, pages } = buildPages([
            { folderName: '1_main', files: [{ fileName: '1_base.sql', text: 'select 1 as x' }] },
            { folderName: '2_sales', files: [{ fileName: '1_derived.sql', text: 'select * from dashql.notebook."main/base"' }] },
        ]);
        const sales = pages[1];

        const { intra, crossPage } = computePageDependencies(sales.entries, scripts, sales.page);
        expect(intra).toHaveLength(0);
        expect(crossPage).toHaveLength(1);
        expect(crossPage[0].from).toBe(sales.entries[0].scriptId);
        expect(crossPage[0].fromFeedIndex).toBe(0);
        expect(crossPage[0].targetPageName).toBe('main'); // clean name, prefix stripped
    });

    it('collapses multiple references into one page to a single cross-page edge', () => {
        const { scripts, pages } = buildPages([
            {
                folderName: '1_main',
                files: [
                    { fileName: '1_a.sql', text: 'select 1 as x' },
                    { fileName: '2_b.sql', text: 'select 2 as y' },
                ],
            },
            {
                folderName: '2_sales',
                files: [{
                    fileName: '1_join.sql',
                    text: 'select * from dashql.notebook."main/a" join dashql.notebook."main/b" using (z)',
                }],
            },
        ]);
        const sales = pages[1];

        const { crossPage } = computePageDependencies(sales.entries, scripts, sales.page);
        expect(crossPage).toHaveLength(1);
        expect(crossPage[0].targetPageName).toBe('main');
    });

    it('ignores unresolved references (no matching script on any page)', () => {
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_base.sql', text: 'select 1 as x' },
            { fileName: '2_derived.sql', text: 'select * from dashql.notebook."ghost/base"' },
        ]);

        const { intra, crossPage } = computePageDependencies(entries, scripts, page);
        expect(intra).toHaveLength(0);
        expect(crossPage).toHaveLength(0);
    });

    it('contributes no edges for entries without an analyzed buffer', () => {
        const { page, entries } = buildPage('1_main', [
            { fileName: '1_base.sql', text: 'select 1 as x' },
            { fileName: '2_derived.sql', text: 'select * from dashql.notebook."base"' },
        ]);
        // Replace the derived entry's script data with one lacking an analyzed buffer.
        const bareScripts: ScriptDataMap = {
            [entries[0].scriptId]: { scriptAnalysis: { buffers: { analyzed: null, parsed: null, destroy: () => {} }, outdated: false } } as unknown as ScriptData,
            [entries[1].scriptId]: { scriptAnalysis: { buffers: { analyzed: null, parsed: null, destroy: () => {} }, outdated: false } } as unknown as ScriptData,
        };

        const { intra, crossPage } = computePageDependencies(entries, bareScripts, page);
        expect(intra).toHaveLength(0);
        expect(crossPage).toHaveLength(0);
    });
});
