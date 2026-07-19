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

/// Build a page + fully-analyzed script map for a set of feed entries. Each entry
/// is registered in a shared catalog under its notebook path (clean folder/file),
/// mirroring analyzeNotebookScript, so cross-script references resolve.
function buildPage(
    folderName: string,
    files: { fileName: string; text: string }[],
): { page: NotebookPage; scripts: ScriptDataMap; entries: NotebookPageScript[] } {
    const catalog = dql!.createCatalog();
    const scripts: ScriptDataMap = {};
    const pageScripts: { [fileName: string]: NotebookPageScript } = {};
    const entries: NotebookPageScript[] = [];

    files.forEach(({ fileName, text }, i) => {
        const script = dql!.createScript(catalog);
        const scriptKey = script.getCatalogEntryId();
        script.insertTextAt(0, text);
        // Register under the clean display path, exactly as analyzeNotebookScript does.
        script.setNotebookPath(`${normalizePageName(folderName)}/${scriptDisplayName(fileName)}`);
        const buffers = analyzeScript(script);
        catalog.loadScript(script, scriptKey);

        const scriptData = {
            scriptKey,
            scriptAnalysis: { buffers, outdated: false },
            fileName,
            folderName,
        } as unknown as ScriptData;
        scripts[scriptKey] = scriptData;

        const pageScript = createPageScript(scriptKey, fileName);
        pageScripts[fileName] = pageScript;
        entries.push(pageScript);
        void i;
    });

    return { page: { folderName, scripts: pageScripts }, scripts, entries };
}

describe('computePageDependencies', () => {
    it('finds a plain-SQL FROM-clause reference into the notebook namespace', () => {
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_base.sql', text: 'select 1 as x' },
            { fileName: '2_derived.sql', text: 'select * from dashql.notebook."main/base"' },
        ]);

        const deps = computePageDependencies(entries, scripts, page);
        expect(deps).toHaveLength(1);
        expect(deps[0].fromFeedIndex).toBe(1); // the derived (dependent) entry
        expect(deps[0].toFeedIndex).toBe(0); // the base (source) entry
        expect(deps[0].from).toBe(entries[1].scriptId);
        expect(deps[0].to).toBe(entries[0].scriptId);
    });

    it('finds a VISUALIZE script reference', () => {
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_base.sql', text: 'select 1 as x, 2 as y' },
            { fileName: '2_chart.sql', text: 'VISUALIZE dashql.notebook."main/base" USING vegalite (mark => bar)' },
        ]);

        const deps = computePageDependencies(entries, scripts, page);
        expect(deps.some(d => d.from === entries[1].scriptId && d.to === entries[0].scriptId)).toBe(true);
    });

    it('drops forward references (only backward edges are kept)', () => {
        // The first entry references the second (a forward ref) — must be dropped so the edge set
        // stays a feed-order DAG.
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_a.sql', text: 'select * from dashql.notebook."main/b"' },
            { fileName: '2_b.sql', text: 'select 1 as x' },
        ]);

        const deps = computePageDependencies(entries, scripts, page);
        expect(deps).toHaveLength(0);
    });

    it('ignores references that do not resolve within the page', () => {
        const { page, scripts, entries } = buildPage('1_main', [
            { fileName: '1_base.sql', text: 'select 1 as x' },
            { fileName: '2_derived.sql', text: 'select * from dashql.notebook."other_page/base"' },
        ]);

        const deps = computePageDependencies(entries, scripts, page);
        expect(deps).toHaveLength(0);
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

        const deps = computePageDependencies(entries, bareScripts, page);
        expect(deps).toHaveLength(0);
    });
});
