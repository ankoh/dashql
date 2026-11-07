import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL;

beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});

afterEach(() => {
    dql.resetUnsafe();
});

const SPEC = JSON.stringify({
    format: 1,
    namespace: 'tickets',
    functions: [
        {
            name: 'ticket_list',
            method: 'GET',
            path: '/tickets',
            options: [
                { name: 'project', wire: 'project', in: 'query', type: 'string', required: true },
                { name: 'page_size', wire: 'pageSize', in: 'query', type: 'integer' },
            ],
        },
    ],
});

function analyze(catalog: dashql.DashQLCatalog, text: string) {
    const script = dql.createScript(catalog);
    script.insertTextAt(0, text);
    script.analyze();
    return script;
}

describe('Overlays', () => {
    it('describes calls in the namespace of an overlay', () => {
        const catalog = dql.createCatalog();
        expect(catalog.registerOverlay(SPEC)).toEqual('tickets');
        const analyzed = analyze(catalog, `call tickets.ticket_list (project => 'it''s', page_size => :size);`).getAnalyzed().read();

        expect(analyzed.errorsLength()).toEqual(0);
        expect(analyzed.overlayCallsLength()).toEqual(1);
        const call = analyzed.overlayCalls(0)!;
        expect(call.namespaceName()).toEqual('tickets');
        expect(call.functionName()).toEqual('ticket_list');
        expect(call.effect()).toEqual(dashql.buffers.analyzer.OverlayEffect.READ);
        expect(JSON.parse(call.description()!)).toEqual({
            namespace: 'tickets',
            function: 'ticket_list',
            effect: 'read',
            explain: false,
            options: { project: "it's", page_size: null },
            bindings: [{ pointer: '/page_size', param: 'size' }],
        });
    });

    it('shadows the namespace and leaves other calls to the backend', () => {
        const catalog = dql.createCatalog();
        catalog.registerOverlay(SPEC);
        const analyzed = analyze(catalog, 'call tickets.ticket_lst (); call other.procedure (a => 1);').getAnalyzed().read();

        expect(analyzed.overlayCallsLength()).toEqual(1);
        expect(analyzed.overlayCalls(0)!.functionName()).toBeNull();
        expect(analyzed.overlayCalls(0)!.description()).toBeNull();
        expect(analyzed.overlayCalls(0)!.effect()).toEqual(dashql.buffers.analyzer.OverlayEffect.WRITE);
        expect(analyzed.errorsLength()).toEqual(1);
        expect(analyzed.errors(0)!.errorType()).toEqual(dashql.buffers.analyzer.AnalyzerErrorType.OVERLAY_UNKNOWN_FUNCTION);
        expect(analyzed.errors(0)!.message()).toContain('did you mean ticket_list?');
    });

    it('completes the options of a function', () => {
        const catalog = dql.createCatalog();
        catalog.registerOverlay(SPEC);
        const text = 'call tickets.ticket_list (';
        const script = analyze(catalog, text);
        script.moveCursor(text.length);
        const completion = script.completeAtCursor(10).read();
        const candidates: string[] = [];
        for (let i = 0; i < completion.candidatesLength(); ++i) {
            candidates.push(completion.candidates(i)!.completionText()!);
        }
        expect(candidates).toEqual(['project', 'page_size']);
    });

    it('only applies while the overlay is registered', () => {
        const catalog = dql.createCatalog();
        const before = catalog.createSnapshot().read().catalogReader.catalogVersion();
        catalog.registerOverlay(SPEC);
        expect(catalog.createSnapshot().read().catalogReader.catalogVersion()).toBeGreaterThan(before);
        catalog.dropOverlay('tickets');
        const analyzed = analyze(catalog, 'call tickets.ticket_list ();').getAnalyzed().read();
        expect(analyzed.overlayCallsLength()).toEqual(0);
        expect(analyzed.errorsLength()).toEqual(0);
    });

    it('rejects invalid specs and a namespace that is taken', () => {
        const catalog = dql.createCatalog();
        expect(() => catalog.registerOverlay('{')).toThrow(/invalid overlay/);
        expect(() => catalog.registerOverlay(JSON.stringify({ format: 2, namespace: 'x' }))).toThrow(/unsupported overlay format/);
        catalog.registerOverlay(SPEC);
        expect(() => catalog.registerOverlay(SPEC)).toThrow(/already registered/);
    });
});
