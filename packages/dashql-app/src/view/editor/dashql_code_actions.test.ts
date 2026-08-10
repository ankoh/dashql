import * as dashql from '../../core/index.js';

import { analyzeScript, DashQLProcessorState } from './dashql_processor.js';
import { buildInlineSourceSQL, findInlineSourceSQLTarget, inlineAllScriptReferences } from './dashql_code_actions.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

afterEach(() => dql.resetUnsafe());

function createState(): { state: DashQLProcessorState; text: string; source: dashql.DashQLScript } {
    const catalog = dql.createCatalog();
    const source = dql.createScript(catalog);
    source.setScriptPath('main/source');
    source.insertTextAt(0, 'select 1 as x;');
    source.analyze();
    catalog.loadScript(source, 0);

    const text = 'visualize dashql.script."main/source" using vegalite ( mark => bar )';
    const visual = dql.createScript(catalog);
    visual.insertTextAt(0, text);
    const scriptBuffers = analyzeScript(visual);

    return {
        text,
        source,
        state: {
            scriptRegistry: null,
            scriptKey: visual.getCatalogEntryId(),
            script: visual,
            scriptBuffers,
            scriptCursor: null,
            scriptCompletion: null,
            scriptPendingDiff: null,
            derivedFocus: null,
            lookupScript: scriptKey => scriptKey === source.getCatalogEntryId() ? source : null,
            onNavigateToScript: undefined,
            onUpdate: () => {},
        },
    };
}

describe('DashQL code actions', () => {
    it('targets only the qualified visualize script reference', () => {
        const { state, text } = createState();
        const target = findInlineSourceSQLTarget(state, text.indexOf('main/source'));

        expect(target).not.toBeNull();
        expect(text.slice(target!.from, target!.to)).toBe('dashql.script."main/source"');
        expect(target!.canInline).toBe(true);
        expect(findInlineSourceSQLTarget(state, text.indexOf('vegalite'))).toBeNull();
    });

    it('inlines and pretty-formats one source reference', () => {
        const { state, text } = createState();
        const target = findInlineSourceSQLTarget(state, text.indexOf('main/source'))!;
        const rewritten = buildInlineSourceSQL(state, target)!;

        expect(rewritten).not.toContain('dashql.script');
        expect(rewritten.toLowerCase()).toContain('select 1 as x');
        expect(rewritten.toLowerCase()).toContain('using vegalite');
    });

    it('inlines all resolved script references', () => {
        const { state } = createState();
        const rewritten = inlineAllScriptReferences(state)!;

        expect(rewritten).not.toContain('dashql.script');
        expect(rewritten.toLowerCase()).toContain('select 1 as x');
    });
});
