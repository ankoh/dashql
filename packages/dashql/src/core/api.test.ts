import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    const wasmBinary = await loadCoreWasm();
    dql = await dashql.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});
afterEach(async () => {
    dql!.resetUnsafe();
});

describe('DashQL setup', () => {
    it('instantiates WebAssembly module', async () => {
        expect(dql).not.toBeNull();
        expect(dql).not.toBeUndefined();
    });

    it('installs the panic listener of the core', () => {
        // The panic hook of the module reports through this global
        const report = (globalThis as { __dashqlCorePanic?: (message: string) => void }).__dashqlCorePanic;
        expect(typeof report).toBe('function');
        expect(dashql.getCorePanic()).toBeNull();
        const messages: string[] = [];
        const unsubscribe = dashql.onCorePanic(message => messages.push(message));
        try {
            report!('panicked at src/catalog/mod.rs');
            report!('panicked again');
            expect(messages).toEqual(['panicked at src/catalog/mod.rs', 'panicked again']);
            // The first panic is kept, later listeners learn about it right away
            expect(dashql.getCorePanic()).toBe('panicked at src/catalog/mod.rs');
            const late: string[] = [];
            dashql.onCorePanic(message => late.push(message))();
            expect(late).toEqual(['panicked at src/catalog/mod.rs']);
        } finally {
            unsubscribe();
        }
    });

    it('copies FlatBuffer strings from shared Wasm memory before decoding them', () => {
        const decoder = dql!.decoder;
        const nativeDecoder = new TextDecoder();
        dql!.decoder = {
            decode(input?: AllowSharedBufferSource) {
                if (ArrayBuffer.isView(input) && input.buffer instanceof SharedArrayBuffer) {
                    throw new TypeError('The provided ArrayBufferView value must not be shared');
                }
                return nativeDecoder.decode(input);
            },
        } as TextDecoder;

        try {
            const catalog = dql!.createCatalog();
            const script = dql!.createScript(catalog);
            script.replaceText('CREATE TABLE foo(a INT)');
            script.analyze();
            const table = script.getAnalyzed().read().tables(0);
            expect(table?.tableName()?.tableName()).toBe('foo');
            expect(table?.tableColumns(0)?.columnName()).toBe('a');
        } finally {
            dql!.decoder = decoder;
        }
    });

});

describe('DashQL @vis tags', () => {
    it('rewrites the renderer and the board placement of a query', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'select 1 as a;\n/* @vis table */\nselect 2 as b');

        expect(session.rewriteVisBoard(1, null, 3, 6, 4)).toBe(
            'select 1 as a;\n/**\n * @vis table\n * @board column=3 width=6 height=4\n */\nselect 2 as b');
        // The gutter keeps a template line that starts with `*`
        expect(session.rewriteVisRenderer(1, 'markdown', '**{{b}}**')).toBe(
            'select 1 as a;\n/**\n * @vis markdown\n * **{{b}}**\n */\nselect 2 as b');
        expect(session.rewriteVisRenderer(0, 'vegalite', '{"mark": "bar"}')).toBe(
            '/**\n * @vis vegalite\n * {"mark": "bar"}\n */\nselect 1 as a;\n/* @vis table */\nselect 2 as b');
        expect(session.rewriteVisRenderer(1, null)).toBe('select 1 as a;\nselect 2 as b');
        expect(() => session.rewriteVisRenderer(1, 'vegalite', '[1]')).toThrow('JSON object');
        // A query without a renderer is placed too, it is a collapsed card on the board
        expect(session.rewriteVisBoard(0, null, null, 6, 3)).toBe(
            '/** @board width=6 height=3 */\nselect 1 as a;\n/* @vis table */\nselect 2 as b');
        session.destroy();
        catalog.destroy();
    });

    it('places a script on the dataflow canvas', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'create table t (a int);\nselect a from t');

        const placed = session.rewriteVisFlow({ position: { x: -16.4, y: 240 } });
        expect(placed).toBe('create table t (a int);\n/** @flow x=-16 y=240 */\nselect a from t');
        session.replaceText(1n, placed);
        const position = session.analyze().scriptAnnotations?.flowPosition;
        expect([position?.statementId, position?.x, position?.y, position?.width, position?.height]).toEqual([1, -16, 240, null, null]);
        // A resized box without a position
        const sized = session.rewriteVisFlow({ width: 400.2, height: 96 });
        expect(sized).toBe('create table t (a int);\n/** @flow width=400 height=96 */\nselect a from t');
        session.replaceText(2n, sized);
        const size = session.analyze().scriptAnnotations?.flowPosition;
        expect([size?.x, size?.y, size?.width, size?.height]).toEqual([null, null, 400, 96]);
        expect(session.removeVisFlow()).toBe('create table t (a int);\nselect a from t');
        session.destroy();
        catalog.destroy();
    });
});

describe('DashQL planner', () => {
    const execution = dashql.buffers.execution;
    function prepare(catalog: dashql.DashQLCatalog, sql: string, publish = false): dashql.DashQLScriptSession {
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, sql);
        expect(session.analyze().analysisAvailable).toBe(true);
        session.loadIntoCatalog();
        if (!publish) {
            // Dropping forces analysis to refresh past the publication's catalog revision.
            session.dropFromCatalog();
            session.analyze();
        }
        return session;
    }

    /// Collect the inputs of scripts of one catalog as the session of one connection
    function collect(catalog: dashql.DashQLCatalog, sessions: readonly dashql.DashQLScriptSession[]) {
        return dql!.collectSessionInputs({
            connections: [{ id: 'c', local: false, catalog }],
            scripts: sessions.map(session => ({ name: '', connection: 0, session })),
        });
    }

    it('projects the columns of the result of a session', () => {
        const catalog = dql!.createCatalog();
        try {
            const formatting = dashql.buffers.formatting;
            const config = new formatting.FormattingConfigT(formatting.FormattingDialect.HYPER, formatting.FormattingMode.PRETTY, 80, 4, false, formatting.KeywordCase.UPPER);
            const projected = prepare(catalog, 'select 1 as a, 2 as "user";').rewriteResultProjection(['a', 'user'], config);
            expect(projected).toMatch(/^WITH base AS \(\n/);
            expect(projected).toContain('"user"');
            expect(projected).toMatch(/FROM base;$/);
            expect(() => prepare(catalog, 'select 1 as a; drop table t').rewriteResultProjection(['a'], config)).toThrow('The last statement is no query');
        } finally {
            catalog.destroy();
        }
    });

    it('collects the inputs of a session and writes their values', () => {
        const catalog = dql!.createCatalog();
        try {
            const a = prepare(catalog, "/* @param :min = 10\n   @param :span = interval '3' day */\nselect * from (select 1 as x) t where x > :min::int and now() - :span < now()");
            const b = prepare(catalog, "select :min, :region where :flag");
            const request = {
                connections: [{ id: 'c', local: false, catalog }],
                scripts: [
                    { name: 'a', connection: 0, session: a },
                    { name: 'b', connection: 0, session: b },
                ],
            };
            const inputs = dql!.collectSessionInputs(request).unpack() as execution.SessionInputsT;
            expect(inputs.inputs.map(i => [i.name, i.literal, i.value, i.typeSource, i.sqlType?.sql])).toEqual([
                ['min', '10', '10', execution.SessionInputTypeSource.CAST, 'integer'],
                ['span', "interval '3' day", '3 day', execution.SessionInputTypeSource.LITERAL, 'interval'],
                ['region', null, null, execution.SessionInputTypeSource.NONE, 'text'],
                ['flag', null, null, execution.SessionInputTypeSource.NONE, 'text'],
            ]);
            expect(inputs.inputs[0].consumers.map(c => [c.script, c.statement])).toEqual([[0, 0], [1, 0]]);
            expect(b.rewriteParamTag('min', '20')).toBe('/** @param :min = 20 */\nselect :min, :region where :flag');
            expect(() => b.rewriteParamTag('min', 'now()')).toThrow();
            expect(a.removeParamTag('span')).toBe('/** @param :min = 10 */\nselect * from (select 1 as x) t where x > :min::int and now() - :span < now()');
            // The literal of the value of a control follows the type of the input
            expect(dql!.inputLiteral('3 day', 'interval')).toBe("interval '3' day");
            expect(() => dql!.inputLiteral('3 days', 'interval')).toThrow();
            expect(dql!.inputLiteral("it's", null)).toBe("'it''s'");
            expect(dql!.inputLiteral('10', null)).toBe('10');
            expect(() => dql!.inputLiteral('ten', 'integer')).toThrow();
            expect(dql!.inputLiteral('2024-01-01 10:00+02', 'timestamp with time zone')).toBe("timestamptz '2024-01-01 10:00+02'");
            expect(() => dql!.inputLiteral('1.5', 'numeric(10, 2)[]')).not.toThrow();
            // A rewrite of the text reaches the editor as the change between the texts, in UTF-16 code units
            expect(dql!.textChange('/** @param :min = 10 */', '/** @param :min = 20 */')).toEqual({ from: 18, to: 19, insert: '2' });
            expect(dql!.textChange('€ 1', '€ 2')).toEqual({ from: 2, to: 3, insert: '2' });
            expect(dql!.textChange('a😀b', 'a😁b')).toEqual({ from: 1, to: 3, insert: '😁' });
            for (const session of [a, b]) session.destroy();
        } finally {
            catalog.destroy();
        }
    });

    it('finds the script references of a session in its analysis', () => {
        const catalog = dql!.createCatalog();
        try {
            const text = "select ':foo é' /* :foo */, * from :foo f, :Nope";
            const session = prepare(catalog, text);
            expect(session.findScriptReferences(['bar', 'foo'])).toEqual([
                { from: text.indexOf(':foo f'), to: text.indexOf(':foo f') + 4, script: 1 },
                { from: text.indexOf(':Nope'), to: text.indexOf(':Nope') + 5, script: null },
            ]);
            session.destroy();
        } finally {
            catalog.destroy();
        }
    });

    it('publishes the results of scripts that table parameters read', () => {
        const catalog = dql!.createCatalog();
        const results = dql!.createTableParameters();
        try {
            const foo = prepare(catalog, 'select 1 as amount');
            const bar = prepare(catalog, 'select f.amount from :foo f');
            const scripts = [{ name: 'foo', session: foo }, { name: 'bar', session: bar }];
            expect(results.publish(scripts)).toEqual([1]);
            // The analysis of bar resolves the column through the result of foo
            const columns = bar.analyze().semanticSpans.filter(span =>
                span.kind === dashql.buffers.editor.EditorSemanticReferenceKind.COLUMN);
            expect(columns.map(span => span.resolution)).toEqual([dashql.buffers.editor.EditorSemanticResolution.RESOLVED]);
            // Unchanged results outdate nothing
            foo.analyze();
            expect(results.publish(scripts)).toEqual([]);
            for (const session of [foo, bar]) session.destroy();
        } finally {
            results.destroy();
            catalog.destroy();
        }
    });

    it('publishes the columns of attachments that table parameters read', () => {
        const catalog = dql!.createCatalog();
        const registry = dql!.createTableParameters();
        try {
            const bar = prepare(catalog, 'select s.region from :sales s');
            const scripts = [{ name: 'bar', session: bar }];
            const sales = { name: 'sales', file: 'sales.parquet', stamp: '1', columns: ['region'] };
            expect(registry.publish(scripts, [sales])).toEqual([0]);
            const columns = bar.analyze().semanticSpans.filter(span =>
                span.kind === dashql.buffers.editor.EditorSemanticReferenceKind.COLUMN);
            expect(columns.map(span => span.resolution)).toEqual([dashql.buffers.editor.EditorSemanticResolution.RESOLVED]);
            // Another stamp with the same columns outdates nothing
            expect(registry.publish(scripts, [{ ...sales, stamp: '2' }])).toEqual([]);
            bar.destroy();
        } finally {
            registry.destroy();
            catalog.destroy();
        }
    });

    it('rejects foreign, destroyed, null, and non-session inputs before entering native code', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1');
        const other = new dashql.DashQL(dql!.bindings);
        expect(other).not.toBe(dql);
        const foreign = other.createScriptSession(other.createCatalog());
        const collectSessionInputs = vi.spyOn(dql!.bindings, 'collectSessionInputs');
        try {
            expect(() => collect(catalog, [session, foreign])).toThrow('different DashQL instance');
            expect(() => collect(other.createCatalog(), [session])).toThrow('different DashQL instance');
            session.destroy();
            expect(() => collect(catalog, [session])).toThrow(dashql.NULL_POINTER_EXCEPTION);
            for (const input of [null, undefined, {}, [null], [undefined], [{}], new Array(1)]) {
                expect(() => dql!.collectSessionInputs({ connections: [{ id: 'c', local: false, catalog }], scripts: input as unknown as dashql.SessionPlanRequest['scripts'] })).toThrow(TypeError);
            }
            expect(collectSessionInputs).not.toHaveBeenCalled();
        } finally {
            collectSessionInputs.mockRestore();
            other.resetUnsafe();
        }
    });

    it('frees the native request when collecting throws', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1');
        const baseline = dql!.registeredMemory.size;
        const collectSessionInputs = vi.spyOn(dql!.bindings, 'collectSessionInputs').mockImplementation(() => {
            throw new Error('test failure');
        });
        const free = vi.spyOn(dql!.bindings.SessionPlanRequest.prototype, 'free');
        try {
            expect(() => collect(catalog, [session])).toThrow('test failure');
            expect(free).toHaveBeenCalledTimes(1);
            expect(dql!.registeredMemory.size).toBe(baseline);
        } finally {
            collectSessionInputs.mockRestore();
            free.mockRestore();
        }
    });
});

describe('DashQL editor sessions', () => {
    const formattingConfig = () => new dashql.buffers.formatting.FormattingConfigT(
        dashql.buffers.formatting.FormattingDialect.HYPER,
        dashql.buffers.formatting.FormattingMode.INLINE,
        80,
        4,
    );

    it('allocates entry ids that are unique across catalogs', () => {
        const first = dql!.createCatalog();
        const second = dql!.createCatalog();
        const a = dql!.createScriptSession(first);
        const b = dql!.createScriptSession(second);
        expect(a.getCatalogEntryId()).not.toBe(b.getCatalogEntryId());
        b.destroy();
        a.destroy();
        second.destroy();
        first.destroy();
    });

    it('moves a script session into another catalog under its entry id', () => {
        const first = dql!.createCatalog();
        const second = dql!.createCatalog();
        const original = dql!.createScriptSession(first);
        const entryId = original.getCatalogEntryId();
        original.replaceText(0n, 'create table foo(a int)');
        original.analyze();
        original.loadIntoCatalog();
        // The entry id is in use in the first catalog
        expect(() => dql!.createScriptSessionWithEntryId(first, entryId)).toThrow();
        // An id that no catalog allocated is refused
        expect(() => dql!.createScriptSessionWithEntryId(second, 0xFFFFFF)).toThrow();
        const moved = dql!.createScriptSessionWithEntryId(second, entryId);
        expect(moved.getCatalogEntryId()).toBe(entryId);
        moved.destroy();
        original.destroy();
        second.destroy();
        first.destroy();
    });

    it('owns and destroys the native session', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);

        expect(session.getText()).toBe('');
        expect(session.getCatalogEntryId()).toBe(session.catalog_entry_id);
        expect(session.getTextVersion()).toBe(0n);
        expect(session.getStateRevision()).toBe(0n);
        expect(dql!.registeredMemory.size).toBe(2);

        const update = session.replaceText(0n, 'select 1');
        expect(update.status).toBe(dashql.buffers.editor.EditorUpdateStatus.OK);
        expect(update.textVersion).toBe(1n);
        expect(session.getTextVersion()).toBe(update.textVersion);
        expect(dql!.registeredMemory.size).toBe(2);

        session.destroy();
        expect(dql!.registeredMemory.size).toBe(1);
        expect(() => session.getText()).toThrow(dashql.NULL_POINTER_EXCEPTION);
        session.destroy();
        catalog.destroy();
    });

    it('rejects stale text versions without changing session state', () => {
        const session = dql!.createScriptSession(dql!.createCatalog());
        session.replaceText(0n, 'select 1');
        const snapshot = session.setCursor(1n, 8n);
        const event = new dashql.buffers.editor.EditorEventT(
            0n,
            [new dashql.buffers.editor.EditorTextChangeT(7n, 8n, '2')],
            new dashql.buffers.editor.EditorSelectionT(0n, 0n),
        );

        for (const update of [session.replaceText(0n, 'select 2'), session.setCursor(0n, 0n), session.apply(event)]) {
            expect(update.status).toBe(dashql.buffers.editor.EditorUpdateStatus.STALE_TEXT_VERSION);
            expect(update.textVersion).toBe(snapshot.textVersion);
            expect(update.stateRevision).toBe(snapshot.stateRevision);
            expect(update.primarySelection).toEqual(snapshot.primarySelection);
            expect(update.analysisAvailable).toBe(snapshot.analysisAvailable);
        }
        expect(session.getText()).toBe('select 1');
        expect(session.getTextVersion()).toBe(1n);
        expect(session.getStateRevision()).toBe(snapshot.stateRevision);
        const unchanged = session.replaceText(1n, 'select 1');
        expect(unchanged.status).toBe(dashql.buffers.editor.EditorUpdateStatus.OK);
        expect(unchanged.textVersion).toBe(1n);
    });

    it('applies a Unicode batch in pre-change UTF-16 offsets', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'aéz');
        const event = new dashql.buffers.editor.EditorEventT(
            1n,
            [
                new dashql.buffers.editor.EditorTextChangeT(1n, 2n, '☃'),
                new dashql.buffers.editor.EditorTextChangeT(3n, 3n, '!'),
            ],
            new dashql.buffers.editor.EditorSelectionT(4n, 4n),
            dashql.buffers.editor.EditorEventOrigin.USER,
            dashql.buffers.editor.EditorEventIntent.EDIT,
            dashql.buffers.editor.EditorEventAction.TYPE,
            false,
        );

        const update = session.apply(event);

        expect(update.status).toBe(dashql.buffers.editor.EditorUpdateStatus.OK);
        expect(update.offsetUnit).toBe(dashql.buffers.editor.EditorOffsetUnit.UTF16_CODE_UNITS);
        expect(update.textChanged).toBe(true);
        expect(update.selectionChanged).toBe(true);
        expect(update.primarySelection?.head).toBe(4n);
        expect(session.getText()).toBe('a☃z!');
        expect(session.getTextVersion()).toBe(2n);
    });

    it('clamps an insertion past the document end', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'a😀');
        const event = new dashql.buffers.editor.EditorEventT(
            1n,
            [new dashql.buffers.editor.EditorTextChangeT(100n, 100n, '!')],
            null,
            dashql.buffers.editor.EditorEventOrigin.USER,
            dashql.buffers.editor.EditorEventIntent.EDIT,
            dashql.buffers.editor.EditorEventAction.PASTE,
            false,
        );

        expect(session.apply(event).status).toBe(dashql.buffers.editor.EditorUpdateStatus.OK);
        expect(session.getText()).toBe('a😀!');
    });

    it('publishes portable analysis and cursor state', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        const text = 'create table items (id int); select * from items;';
        session.replaceText(0n, text);
        const cursorUpdate = session.setCursor(1n, BigInt(text.length));

        const update = session.analyze();
        expect(update.status).toBe(dashql.buffers.editor.EditorUpdateStatus.OK);
        expect(cursorUpdate.analysisUpdated).toBe(true);
        expect(update.analysisUpdated).toBe(false);
        expect(update.analysisAvailable).toBe(true);
        expect(session.getStateRevision()).toBe(2n);
        expect(session.getCatalogRevision()).toBe(update.catalogRevision);

        expect(update.scriptAnnotations?.tableDefinitions).toHaveLength(1);
        expect(update.primaryCursorState?.textOffset).toBe(BigInt(text.length));
        expect(update.processingStatistics?.ropeBytes).toBeGreaterThan(0n);
        expect(dql!.registeredMemory.size).toBe(2);
    });

    it('reuses the known analysis for cursor moves', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        const editor = dashql.buffers.editor;
        const text = 'create table items (id int); select id from items;';
        const moveTo = (offset: number) => session.apply(new editor.EditorEventT(
            session.getTextVersion(),
            [],
            new editor.EditorSelectionT(BigInt(offset), BigInt(offset)),
            editor.EditorEventOrigin.USER,
            editor.EditorEventIntent.SELECTION,
        ));
        session.replaceText(0n, text);
        const full = moveTo(text.indexOf('id from'));
        expect(full.analysisUpdated).toBe(true);
        expect(full.analysisOmitted).toBe(false);
        expect(full.syntaxSpans.length).toBeGreaterThan(0);

        const moved = moveTo(text.indexOf('items;') + 1);
        expect(moved.analysisOmitted).toBe(true);
        expect(moved.syntaxSpans).toBe(full.syntaxSpans);
        expect(moved.semanticSpans).toBe(full.semanticSpans);
        expect(moved.diagnostics).toBe(full.diagnostics);
        expect(moved.scriptAnnotations).toBe(full.scriptAnnotations);
        expect(moved.processingStatistics).toBe(full.processingStatistics);
        expect(moved.primaryCursorContext?.kind).toBe(editor.EditorCursorSemanticKind.TABLE_REFERENCE);

        // A text change sends the new analysis
        const typed = session.apply(new editor.EditorEventT(
            session.getTextVersion(),
            [new editor.EditorTextChangeT(BigInt(text.length), BigInt(text.length), ' ')],
            null,
            editor.EditorEventOrigin.USER,
            editor.EditorEventIntent.EDIT,
            editor.EditorEventAction.TYPE,
            true,
        ));
        expect(typed.analysisOmitted).toBe(false);
        expect(typed.syntaxSpans).not.toBe(full.syntaxSpans);
        expect(typed.syntaxSpans.length).toBe(full.syntaxSpans.length);
    });

    it('completes at the session cursor', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 's');
        session.setCursor(1n, 1n);
        session.analyze();

        const completion = session.completeAtCursor(10);
        expect(completion.read().candidates(0)?.completionText()).toBe('select');
    });

    it('compiles, formats, and diffs the session script', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'select 1 as value');
        session.analyze();

        const config = formattingConfig();
        const compilation = session.compileQuery(config);
        expect(compilation.read().sql()).toBe('select 1 as value');
        expect(compilation.read().errorsLength()).toBe(0);

        expect(session.isFullyFormattable(config)).toBe(true);
        const formatted = session.format(config);
        expect(formatted.toString()).toBe('select 1 as value;');

        const target = dql!.createScript(catalog);
        target.replaceText('select 2 as value');
        target.parse();
        const diff = session.computeDiff(target);
        expect(diff.read().opsLength()).toBe(1);
        expect(diff.read().ops(0)?.code()).toBe(dashql.buffers.diff.ScriptDiffOpCode.UPDATE);

        target.destroy();
        formatted.destroy();
    });

    it('refreshes the cached flat catalog when a session publishes', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'create table items (id int)');
        session.analyze();
        const before = catalog.flatten();
        expect(catalog.flatten()).toBe(before);
        expect(before.read().catalogReader.tablesLength()).toBe(0);

        // The session changes the catalog without going through the catalog wrapper
        session.loadIntoCatalog();
        const after = catalog.flatten();
        expect(after).not.toBe(before);
        expect(after.read().catalogReader.tablesLength()).toBe(1);
        session.dropFromCatalog();
        expect(catalog.flatten().read().catalogReader.tablesLength()).toBe(0);
    });

    it('loads and drops the session-owned script from its catalog', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'create table items (id int)');
        session.analyze();

        expect(catalog.containsEntryId(session.catalog_entry_id)).toBeFalsy();
        session.loadIntoCatalog();
        expect(catalog.containsEntryId(session.catalog_entry_id)).toBeTruthy();
        session.dropFromCatalog();
        expect(catalog.containsEntryId(session.catalog_entry_id)).toBeFalsy();

        // Freeing the session releases its memory and leaves the catalog as it is, its owner drops it
        session.loadIntoCatalog();
        const entryId = session.catalog_entry_id;
        session.destroy();
        expect(catalog.containsEntryId(entryId)).toBeTruthy();
    });
});

describe('ContextObjectChildID', () => {
    it('create child ids', () => {
        const parentId = dashql.ExternalObjectID.create(1234, 5678);
        const childId = dashql.ContextObjectChildID.create(parentId, 91011);
        expect(childId).not.toEqual(parentId);
        expect(dashql.ContextObjectChildID.getParent(childId)).toEqual(parentId);
        expect(dashql.ContextObjectChildID.getChild(childId)).toEqual(91011);
        expect(childId.toString()).toEqual("22763282211344411091843");
    });
});
