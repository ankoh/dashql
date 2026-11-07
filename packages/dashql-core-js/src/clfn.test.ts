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
                { name: 'project', api_name: 'project', in: 'query', type: 'string', required: true },
                { name: 'page_size', api_name: 'pageSize', in: 'query', type: 'integer' },
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

describe('Client functions', () => {
    it('describes calls in the namespace of client functions', () => {
        const catalog = dql.createCatalog();
        expect(catalog.registerClientFunctions(SPEC)).toEqual('tickets');
        const analyzed = analyze(catalog, `call tickets.ticket_list (project => 'it''s', page_size => :size);`).getAnalyzed().read();

        expect(analyzed.errorsLength()).toEqual(0);
        expect(analyzed.clientFunctionCallsLength()).toEqual(1);
        const call = analyzed.clientFunctionCalls(0)!;
        expect(call.namespaceName()).toEqual('tickets');
        expect(call.functionName()).toEqual('ticket_list');
        expect(call.effect()).toEqual(dashql.buffers.analyzer.ClientFunctionEffect.READ);
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
        catalog.registerClientFunctions(SPEC);
        const analyzed = analyze(catalog, 'call tickets.ticket_lst (); call other.procedure (a => 1);').getAnalyzed().read();

        expect(analyzed.clientFunctionCallsLength()).toEqual(1);
        expect(analyzed.clientFunctionCalls(0)!.functionName()).toBeNull();
        expect(analyzed.clientFunctionCalls(0)!.description()).toBeNull();
        expect(analyzed.clientFunctionCalls(0)!.effect()).toEqual(dashql.buffers.analyzer.ClientFunctionEffect.WRITE);
        expect(analyzed.errorsLength()).toEqual(1);
        expect(analyzed.errors(0)!.errorType()).toEqual(dashql.buffers.analyzer.AnalyzerErrorType.CLIENT_FUNCTION_UNKNOWN_FUNCTION);
        expect(analyzed.errors(0)!.message()).toContain('did you mean ticket_list?');
    });

    it('completes the options of a function', () => {
        const catalog = dql.createCatalog();
        catalog.registerClientFunctions(SPEC);
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

    it('only applies while their spec is registered', () => {
        const catalog = dql.createCatalog();
        const before = catalog.createSnapshot().read().catalogReader.catalogVersion();
        catalog.registerClientFunctions(SPEC);
        expect(catalog.createSnapshot().read().catalogReader.catalogVersion()).toBeGreaterThan(before);
        catalog.dropClientFunctions('tickets');
        const analyzed = analyze(catalog, 'call tickets.ticket_list ();').getAnalyzed().read();
        expect(analyzed.clientFunctionCallsLength()).toEqual(0);
        expect(analyzed.errorsLength()).toEqual(0);
    });

    it('rejects invalid specs and a namespace that is taken', () => {
        const catalog = dql.createCatalog();
        expect(() => catalog.registerClientFunctions('{')).toThrow(/invalid client function spec/);
        expect(() => catalog.registerClientFunctions(JSON.stringify({ format: 2, namespace: 'x' }))).toThrow(/unsupported client function spec format/);
        catalog.registerClientFunctions(SPEC);
        expect(() => catalog.registerClientFunctions(SPEC)).toThrow(/already registered/);
    });
});
