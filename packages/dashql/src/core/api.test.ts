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
    const absent = 0xffffffff;

    function resolvedTables(session: dashql.DashQLScriptSession) {
        return session.analyze().semanticSpans.filter(span =>
            span.kind === dashql.buffers.editor.EditorSemanticReferenceKind.TABLE &&
            span.resolution === dashql.buffers.editor.EditorSemanticResolution.RESOLVED);
    }

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

    /// Plan scripts of one catalog as the session of one connection
    function plan(catalog: dashql.DashQLCatalog, sessions: readonly dashql.DashQLScriptSession[]) {
        return dql!.planSession({
            connections: [{ id: 'c', local: false, catalog }],
            scripts: sessions.map(session => ({ name: '', connection: 0, session })),
        });
    }

    it('checks the script references of a session in UTF-16 offsets', () => {
        const local = dql!.createCatalog();
        const remote = dql!.createCatalog();
        try {
            const foo = prepare(remote, 'select 1 as a');
            const bar = prepare(local, "select 'é', * from :foo");
            const baz = prepare(remote, 'select * from :bar, :nope');
            const check = dql!.checkScriptReferences({
                connections: [{ id: 'local', local: true, catalog: local }, { id: 'remote', local: false, catalog: remote }],
                scripts: [
                    { name: 'foo', connection: 1, session: foo },
                    { name: 'bar', connection: 0, session: bar },
                    { name: 'baz', connection: 1, session: baz },
                ],
            }).unpack() as execution.ScriptReferenceCheckT;
            expect(check.scripts.map(s => s.checked)).toEqual([true, true, true]);
            const [reference] = check.scripts[1].references;
            expect(reference.kind).toBe(execution.ScriptReferenceKind.SCAN);
            expect(reference.script).toBe(0);
            expect(reference.textSpan!.offset).toBe("select 'é', * from ".length);
            expect(reference.textSpan!.length).toBe(4);
            const invalid = check.scripts[2].references;
            expect(invalid.map(r => r.kind)).toEqual([execution.ScriptReferenceKind.INVALID, execution.ScriptReferenceKind.INVALID]);
            expect(invalid[1].errors).toEqual(['unknown script or attachment :nope']);
            expect(dql!.quoteIdentifier('foo-2')).toBe('"foo-2"');
            expect(dql!.quoteIdentifier('foo')).toBe('foo');
            expect(dql!.quoteColumnName('user')).toBe('"user"');
            expect(dql!.quoteColumnName('name')).toBe('name');
            for (const session of [foo, bar, baz]) session.destroy();
        } finally {
            local.destroy();
            remote.destroy();
        }
    });

    it('derives the dataflow of a session in UTF-16 offsets', () => {
        const catalog = dql!.createCatalog();
        try {
            const schema = prepare(catalog, "create table t (a text);\ninsert into t values ('é')", true);
            const report = prepare(catalog, 'select a from t');
            const chart = prepare(catalog, 'select * from :report');
            const dataflow = dql!.deriveSessionDataflow({
                connections: [{ id: 'c', local: false, catalog }],
                scripts: [
                    { name: 'schema', connection: 0, session: schema },
                    { name: 'report', connection: 0, session: report },
                    { name: 'chart', connection: 0, session: chart },
                ],
            }).unpack() as execution.SessionDataflowT;
            expect(dataflow.scripts.map(s => s.analyzed)).toEqual([true, true, true]);
            const [create, insert] = dataflow.scripts[0].statements;
            expect([create.statementType, create.target]).toEqual([dashql.buffers.parser.StatementType.CREATE_TABLE, 't']);
            expect(insert.textSpan!.offset).toBe('create table t (a text);\n'.length);
            expect(insert.textSpan!.length).toBe("insert into t values ('é')".length);
            const edges = dataflow.edges.map(e => [e.fromScript, e.fromStatement, e.toScript, e.toStatement, e.kind, e.name]);
            expect(edges).toEqual([
                [0, 0, 0, 1, execution.DataflowEdgeKind.TABLE, 't'],
                [0, 1, 1, 0, execution.DataflowEdgeKind.TABLE, 't'],
                [1, 0, 2, 0, execution.DataflowEdgeKind.INLINE_REFERENCE, 'report'],
            ]);
            for (const session of [schema, report, chart]) session.destroy();
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
            const dataflow = dql!.deriveSessionDataflow(request).unpack() as execution.SessionDataflowT;
            expect(dataflow.inputs.map(i => i.name)).toEqual(['min', 'span', 'region', 'flag']);
            const inputEdges = dataflow.edges.filter(e => e.kind === execution.DataflowEdgeKind.INPUT).map(e => [e.fromScript, e.toScript, e.name]);
            expect(inputEdges).toEqual([[0, 0, 'min'], [0, 1, 'min'], [1, 0, 'span'], [2, 1, 'region'], [3, 1, 'flag']]);
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

    it('returns an owned empty graph', () => {
        const result = dql!.planSession({ connections: [], scripts: [] });
        const reader = result.read(new execution.ExecutionGraph());
        expect(reader.valid()).toBe(true);
        expect(reader.nodesLength()).toBe(0);
        expect(reader.scriptsLength()).toBe(0);
        expect(reader.entitiesLength()).toBe(0);
        expect(reader.unresolvedReferencesLength()).toBe(0);
        expect(reader.edgesLength()).toBe(0);
        expect(reader.diagnosticsLength()).toBe(0);
        expect(dql!.registeredMemory.size).toBe(0);
        expect(dql!.registeredMemory.size).toBe(0);
    });

    it('preserves script order, source SQL, revisions, and independent reads', () => {
        const catalog = dql!.createCatalog();
        prepare(catalog, 'create table a (id int); create table b (id int)', true);
        const first = prepare(catalog, '-- description\nselect * from a; select * from b;');
        const second = prepare(catalog, 'select 1; select * from a;');
        // Refresh earlier sessions after all publications, without changing their documents.
        const tables = resolvedTables(first);
        second.analyze();
        const version = first.getCatalogRevision();
        const state = first.getStateRevision();
        const result = plan(catalog, [second, first]);
        const graph = result.read().unpack();
        expect(graph.valid).toBe(true);
        expect(graph.diagnostics).toEqual([]);
        expect(graph.edges).toEqual([]);
        expect(graph.scripts.map(script => [script.scriptId, script.textVersion])).toEqual([
            [second.catalog_entry_id, 1n], [first.catalog_entry_id, 1n],
        ]);
        expect(graph.scripts.every(script => script.analyzedCatalogRevision === version)).toBe(true);
        expect(graph.scripts.every(script => typeof script.analyzedTextVersion === 'bigint' &&
            script.analyzedTextVersion === script.textVersion)).toBe(true);
        expect(graph.nodes.map(node => [node.script, node.statementId, node.sql])).toEqual([
            [0, 0, 'select 1'], [0, 1, 'select * from a'],
            [1, 0, 'select * from a'], [1, 1, 'select * from b'],
        ]);
        expect(graph.nodes.every(node => node.producesOutput && !node.barrier)).toBe(true);
        expect(graph.entities.map(entity => entity.name).sort()).toEqual(['a', 'b']);
        expect(graph.unresolvedReferences).toEqual([]);
        expect(tables).toHaveLength(2);
        for (const table of tables) {
            const entity = graph.entities.find(entity => entity.catalogObjectId?.objectId === table.catalogTableId)!;
            expect(typeof table.catalogTableId).toBe('bigint');
            expect(table.catalogTableId).toBeGreaterThan(0xffffffffn);
            expect(entity).toBeDefined();
            expect(entity.catalogObjectId).toEqual(new execution.ExecutionGraphCatalogObjectIDT(
                execution.ExecutionGraphEntityType.TABLE, table.catalogTableId, 0,
            ));
            expect(entity.catalogDatabaseId).toBe(table.catalogDatabaseId);
            expect(entity.catalogSchemaId).toBe(table.catalogSchemaId);
            expect(entity.databaseName).toBeNull();
            expect(entity.schemaName).toBeNull();
            const packed = result.read().entities(graph.entities.indexOf(entity))!.catalogObjectId()!;
            expect(packed.objectType()).toBe(execution.ExecutionGraphEntityType.TABLE);
            expect(packed.objectId()).toBe(table.catalogTableId);
            expect(packed.subObjectId()).toBe(0);
        }
        for (const node of graph.nodes) {
            for (const access of node.accesses) {
                expect(access.entity).toBeLessThan(graph.entities.length);
                expect(access.unresolvedReference).toBe(absent);
                expect(access.mode).toBe(execution.ExecutionGraphAccessMode.READ);
            }
        }
        expect(first.getCatalogRevision()).toBe(version);
        expect(first.getStateRevision()).toBe(state);
        expect(plan(catalog, [second, first]).unpack()).toEqual(graph);
    });

    it('packs DDL and read/write conflicts across sessions', () => {
        const catalog = dql!.createCatalog();
        const create = prepare(catalog, 'create table a (id int)', true);
        const reads = prepare(catalog, 'select * from a; select * from a');
        const writes = prepare(catalog,
            'insert into a values (1); select * from a; insert into a values (2) returning id');
        create.analyze();
        const [table] = resolvedTables(reads);
        writes.analyze();
        const graph = plan(catalog, [create, reads, writes]).unpack() as
            dashql.buffers.execution.ExecutionGraphT;
        expect(graph.valid).toBe(true);
        expect(graph.nodes).toHaveLength(6);
        expect(graph.entities).toHaveLength(1);
        expect(graph.unresolvedReferences).toEqual([]);
        expect(graph.entities[0].catalogObjectId).toEqual(new execution.ExecutionGraphCatalogObjectIDT(
            execution.ExecutionGraphEntityType.TABLE, table.catalogTableId, 0,
        ));
        expect(typeof graph.entities[0].catalogObjectId!.objectId).toBe('bigint');
        expect(dashql.ExternalObjectID.getOrigin(table.catalogTableId)).toBe(create.catalog_entry_id);
        for (const node of graph.nodes) {
            expect(node.accesses).toHaveLength(1);
            expect(node.accesses[0].entity).toBe(0);
            expect(node.accesses[0].unresolvedReference).toBe(absent);
        }
        for (const edge of graph.edges) {
            expect(edge.entity).toBe(0);
            expect(edge.unresolvedReference).toBe(absent);
        }
        const edges = graph.edges.map(edge => [edge.from, edge.to, edge.reason]);
        expect(edges).toEqual(expect.arrayContaining([
            [0, 1, execution.ExecutionGraphEdgeReason.DDL],
            [0, 2, execution.ExecutionGraphEdgeReason.DDL],
            [1, 3, execution.ExecutionGraphEdgeReason.WRITE_AFTER_READ],
            [2, 3, execution.ExecutionGraphEdgeReason.WRITE_AFTER_READ],
            [3, 4, execution.ExecutionGraphEdgeReason.READ_AFTER_WRITE],
            [3, 5, execution.ExecutionGraphEdgeReason.WRITE_AFTER_WRITE],
            [4, 5, execution.ExecutionGraphEdgeReason.WRITE_AFTER_READ],
        ]));
        expect(edges.some(([from, to]) => from === 1 && to === 2)).toBe(false);
        expect(graph.nodes[0].accesses[0].mode).toBe(execution.ExecutionGraphAccessMode.DDL);
        expect(graph.nodes[3].producesOutput).toBe(false);
        expect(graph.nodes[5].producesOutput).toBe(true);
    });

    it.each([false, true])('keeps external/participating declaration identities across drop/recreate (participating=%s)', participating => {
        const catalog = dql!.createCatalog();
        const create = prepare(catalog, 'create table db.s.a (id int); select * from db.s.a', true);
        const use = prepare(catalog,
            'select * from db.s.a; drop table a; create table db.s.a (id int); select * from db.s.a');
        const [oldTable] = resolvedTables(create);
        const tables = resolvedTables(use);
        const newTable = tables[tables.length - 1];
        const graph = plan(catalog, participating ? [create, use] : [use]).unpack() as
            dashql.buffers.execution.ExecutionGraphT;
        expect(graph.valid).toBe(true);
        expect(graph.diagnostics).toEqual([]);
        expect(graph.entities).toHaveLength(2);
        expect(graph.unresolvedReferences).toEqual([]);
        const offset = participating ? 2 : 0;
        const oldEntity = graph.nodes[offset].accesses[0].entity;
        const newEntity = graph.nodes[offset + 2].accesses[0].entity;
        expect(oldEntity).not.toBe(newEntity);
        expect(oldTable.catalogTableId).not.toBe(newTable.catalogTableId);
        expect(dashql.ExternalObjectID.getOrigin(oldTable.catalogTableId)).toBe(create.catalog_entry_id);
        expect(dashql.ExternalObjectID.getOrigin(newTable.catalogTableId)).toBe(use.catalog_entry_id);
        for (const [index, table] of [[oldEntity, oldTable], [newEntity, newTable]] as const) {
            const entity = graph.entities[index];
            expect(typeof entity.catalogObjectId!.objectId).toBe('bigint');
            expect(entity.catalogObjectId).toEqual(new execution.ExecutionGraphCatalogObjectIDT(
                execution.ExecutionGraphEntityType.TABLE, table.catalogTableId, 0,
            ));
            expect(entity.catalogDatabaseId).toBe(table.catalogDatabaseId);
            expect(entity.catalogSchemaId).toBe(table.catalogSchemaId);
            expect([entity.databaseName, entity.schemaName, entity.name]).toEqual(['db', 's', 'a']);
        }
        expect(graph.nodes.map(node => node.accesses[0].entity)).toEqual(
            participating ? [oldEntity, oldEntity, oldEntity, oldEntity, newEntity, newEntity] :
                [oldEntity, oldEntity, newEntity, newEntity],
        );
        for (const node of graph.nodes) {
            expect(node.accesses).toHaveLength(1);
            expect(node.accesses[0].unresolvedReference).toBe(absent);
        }
        expect(graph.nodes[offset + 1].accesses[0].mode).toBe(execution.ExecutionGraphAccessMode.DDL);
        expect(graph.nodes[offset + 2].accesses[0].mode).toBe(execution.ExecutionGraphAccessMode.DDL);
        for (const edge of graph.edges) {
            expect(edge.reason).toBe(execution.ExecutionGraphEdgeReason.DDL);
            expect(edge.entity).toBe(graph.nodes[edge.to].accesses[0].entity);
            expect(edge.unresolvedReference).toBe(absent);
        }
        expect(graph.edges.map(edge => [edge.from, edge.to, edge.entity])).toEqual(expect.arrayContaining([
            [offset, offset + 1, oldEntity],
            [offset + 1, offset + 2, newEntity],
            [offset + 2, offset + 3, newEntity],
        ]));
        if (participating) {
            expect(graph.edges.map(edge => [edge.from, edge.to, edge.entity])).toContainEqual([0, 1, oldEntity]);
        }
    });

    it('uses unresolved references and barrier sentinels without synthetic entities', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1; select * from db.s.missing; drop table db.s.missing; select 2');
        const result = plan(catalog, [session]);
        const reader = result.read();
        expect(reader.entitiesLength()).toBe(0);
        expect(reader.unresolvedReferencesLength()).toBe(1);
        expect(reader.nodes(1)?.accesses(0)?.entity()).toBe(absent);
        expect(reader.nodes(1)?.accesses(0)?.unresolvedReference()).toBe(0);
        const graph = result.unpack() as dashql.buffers.execution.ExecutionGraphT;
        expect(graph.valid).toBe(true);
        expect(graph.entities).toEqual([]);
        expect(graph.unresolvedReferences.map(reference =>
            [reference.databaseName, reference.schemaName, reference.name])).toEqual([['db', 's', 'missing']]);
        expect(graph.nodes.map(node => node.barrier)).toEqual([false, true, true, false]);
        expect(graph.nodes[0].accesses).toEqual([]);
        expect(graph.nodes[3].accesses).toEqual([]);
        for (const [index, mode] of [[1, execution.ExecutionGraphAccessMode.READ],
            [2, execution.ExecutionGraphAccessMode.DDL]] as const) {
            expect(graph.nodes[index].accesses).toEqual([new execution.ExecutionGraphAccessT(absent, 0, mode)]);
        }
        expect(graph.diagnostics.some(diagnostic => diagnostic.message?.includes('unresolved relation'))).toBe(true);
        expect(graph.diagnostics.some(diagnostic => diagnostic.message?.includes('unresolved DROP'))).toBe(true);
        expect(graph.edges.map(edge => [edge.from, edge.to])).toEqual(expect.arrayContaining([[0, 1], [1, 2], [2, 3]]));
        for (const edge of graph.edges) {
            expect(edge.entity).toBe(absent);
            if (edge.reason === execution.ExecutionGraphEdgeReason.BARRIER) {
                expect(edge.unresolvedReference).toBe(absent);
            } else {
                expect([edge.from, edge.to, edge.reason, edge.unresolvedReference]).toEqual(
                    [1, 2, execution.ExecutionGraphEdgeReason.DDL, 0],
                );
            }
        }
        expect(graph.edges.some(edge => edge.reason === execution.ExecutionGraphEdgeReason.DDL)).toBe(true);
    });

    it('does not analyze or publish missing or edited analysis', () => {
        const catalog = dql!.createCatalog();
        const session = dql!.createScriptSession(catalog);
        session.replaceText(0n, 'select 1');
        const version = session.getCatalogRevision();
        const missing = plan(catalog, [session]).unpack();
        expect(missing.valid).toBe(false);
        expect(missing.nodes).toEqual([]);
        expect(missing.diagnostics[0].message).toContain('missing or stale');
        expect(session.getCatalogRevision()).toBe(version);
        expect(catalog.containsEntryId(session.catalog_entry_id)).toBe(false);
        session.analyze();
        session.loadIntoCatalog();
        session.replaceText(1n, 'select 2');
        const stale = plan(catalog, [session]).unpack();
        expect(stale.valid).toBe(false);
        expect(stale.nodes).toEqual([]);
        session.analyze();
        const refreshed = plan(catalog, [session]).unpack();
        expect(refreshed.valid).toBe(true);
        expect(refreshed.scripts[0].textVersion).toBe(2n);
        expect(refreshed.scripts[0].analyzedTextVersion).toBe(refreshed.scripts[0].textVersion);
        expect(refreshed.nodes[0].sql).toBe('select 2');
    });

    it('plans script references across connections', () => {
        const trino = dql!.createCatalog();
        const local = dql!.createCatalog();
        const foo = prepare(trino, 'select 1 as a');
        const same = prepare(local, 'select 2 as b');
        const bar = prepare(local, 'select * from :foo, :same');
        // Publishing and dropping the scripts moved the catalog revision past the earlier analyses
        for (const session of [foo, same, bar]) session.analyze();
        const request = {
            connections: [{ id: 'trino', local: false, catalog: trino }, { id: 'local', local: true, catalog: local }],
            scripts: [{ name: 'foo', connection: 0, session: foo }, { name: 'same', connection: 1, session: same }, { name: 'bar', connection: 1, session: bar }],
            mountPrefix: '/mnt/external/run',
        };
        const graph = dql!.planSession(request).unpack();
        expect(graph.diagnostics.map(d => d.message)).toEqual([]);
        expect(graph.valid).toBe(true);
        expect(graph.connections.map(c => [c.connectionId, c.kind])).toEqual([
            ['trino', execution.ExecutionGraphConnectionKind.REMOTE], ['local', execution.ExecutionGraphConnectionKind.LOCAL]]);
        expect(graph.materializations.map(m => [m.script, m.node, m.path])).toEqual([[0, 0, '/mnt/external/run/s0.parquet']]);
        const consumer = graph.nodes[2];
        expect(consumer.sql).toBe(
            "with foo as (select * from external('/mnt/external/run/s0.parquet', format => 'parquet')),\nsame as (\nselect 2 as b\n)\nselect * from foo, same");
        expect(consumer.inputs).toEqual([0]);
        expect(consumer.scriptResult).toBe(true);
        expect(graph.scripts[2].referencedScripts).toEqual([0, 1]);
        expect(graph.edges.map(e => [e.from, e.to, e.reason])).toEqual([[0, 2, execution.ExecutionGraphEdgeReason.MATERIALIZATION]]);

        // A plan of the target with a provided materialization runs the target only
        // The host names the file of a materialized result
        const named = dql!.planSession({ ...request, scripts: request.scripts.map((script, index) => index === 0 ? { ...script, materializationFile: 'key.0123.parquet' } : script) }).unpack();
        expect(named.materializations.map(m => m.path)).toEqual(['/mnt/external/run/key.0123.parquet']);

        const targeted = dql!.planSession({ ...request, targets: [2], materialized: [0] }).unpack();
        expect(targeted.valid).toBe(true);
        expect(targeted.nodes.map(n => n.script)).toEqual([2]);
        expect(targeted.materializations[0].node).toBe(absent);
        expect(targeted.scripts.map(s => s.planned)).toEqual([true, true, true]);
        expect(targeted.scripts.map(s => s.target)).toEqual([false, false, true]);
    });

    it('reports script reference errors with their text', () => {
        const remote = dql!.createCatalog();
        const other = dql!.createCatalog();
        const foo = prepare(remote, 'select 1 as a');
        const bar = prepare(other, 'select * from :foo');
        for (const session of [foo, bar]) session.analyze();
        const graph = dql!.planSession({
            connections: [{ id: 'trino', local: false, catalog: remote }, { id: 'salesforce', local: false, catalog: other }],
            scripts: [{ name: 'foo', connection: 0, session: foo }, { name: 'bar', connection: 1, session: bar }],
        }).unpack();
        expect(graph.valid).toBe(false);
        expect(graph.nodes).toEqual([]);
        expect(graph.diagnostics.map(d => [d.script, d.error, d.textSpan?.offset, d.textSpan?.length, d.message])).toEqual([
            [1, true, 14, 4, 'bar.sql runs on the connection salesforce and cannot read foo.sql of the connection trino']]);
    });

    it('reports scripts of other catalogs and duplicates as graph diagnostics', () => {
        const catalog = dql!.createCatalog();
        const first = prepare(catalog, 'select 1');
        const second = prepare(dql!.createCatalog(), 'select 2');
        for (const [sessions, message] of [
            [[first, second], 'another catalog'], [[first, first], 'duplicate'],
        ] as const) {
            const graph = plan(catalog, sessions).unpack();
            expect(graph.valid).toBe(false);
            expect(graph.nodes).toEqual([]);
            expect(graph.diagnostics.some((diagnostic: dashql.buffers.execution.ExecutionGraphDiagnosticT) =>
                diagnostic.message?.includes(message))).toBe(true);
        }
    });

    it('reports catalog-stale analysis without refreshing it automatically', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1');
        prepare(catalog, 'create table added (id int)', true);
        const revision = session.getCatalogRevision();
        const state = session.getStateRevision();
        const stale = plan(catalog, [session]).unpack();
        expect(stale.valid).toBe(false);
        expect(stale.nodes).toEqual([]);
        expect(stale.diagnostics.some((diagnostic: dashql.buffers.execution.ExecutionGraphDiagnosticT) =>
            diagnostic.message?.includes('catalog'))).toBe(true);
        expect(session.getCatalogRevision()).toBe(revision);
        expect(session.getStateRevision()).toBe(state);
        session.analyze();
        const refreshed = plan(catalog, [session]).unpack();
        expect(refreshed.valid).toBe(true);
        expect(refreshed.scripts[0].analyzedCatalogRevision).toBe(revision);
        expect(refreshed.nodes[0].sql).toBe('select 1');
    });

    it('plans large script arrays and frees the native request', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1');
        const baseline = dql!.registeredMemory.size;
        const free = vi.spyOn(dql!.bindings.SessionPlanRequest.prototype, 'free');
        try {
            const result = plan(catalog, new Array(300000).fill(session));
            expect(result.read().valid()).toBe(false);
            expect(result.read().nodesLength()).toBe(0);
            expect(result.read().diagnostics(0)?.message()).toContain('duplicate');
            expect(free).toHaveBeenCalledTimes(1);
            expect(dql!.registeredMemory.size).toBe(baseline);
        } finally {
            free.mockRestore();
        }
    });

    it('rejects foreign, destroyed, null, and non-session inputs before entering native code', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1');
        const other = new dashql.DashQL(dql!.bindings);
        expect(other).not.toBe(dql);
        const foreign = other.createScriptSession(other.createCatalog());
        const planSession = vi.spyOn(dql!.bindings, 'planSession');
        try {
            expect(() => plan(catalog, [session, foreign])).toThrow('different DashQL instance');
            expect(() => plan(other.createCatalog(), [session])).toThrow('different DashQL instance');
            session.destroy();
            expect(() => plan(catalog, [session])).toThrow(dashql.NULL_POINTER_EXCEPTION);
            for (const input of [null, undefined, {}, [null], [undefined], [{}], new Array(1)]) {
                expect(() => dql!.planSession({ connections: [{ id: 'c', local: false, catalog }], scripts: input as any })).toThrow(TypeError);
            }
            expect(planSession).not.toHaveBeenCalled();
        } finally {
            planSession.mockRestore();
            other.resetUnsafe();
        }
    });

    it('owns detached graph bytes and preserves unpacked data after release', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1');
        const first = plan(catalog, [session]);
        const second = plan(catalog, [session]);
        expect(first.equals(second)).toBe(false);
        expect(dql!.registeredMemory.size).toBe(2);
        session.replaceText(1n, 'select 2');
        session.destroy();
        catalog.destroy();
        expect(dql!.registeredMemory.size).toBe(0);
        expect(first.read().nodes(0)?.sql()).toBe('select 1');
        const unpacked = first.unpack();
        expect(first.read().nodes(0)?.sql()).toBe('select 1');
        dql!.resetUnsafe();
        expect(second.read().nodes(0)?.sql()).toBe('select 1');
        expect(unpacked.nodes[0].sql).toBe('select 1');
        expect(unpacked.scripts[0].textVersion).toBe(1n);
        expect(unpacked.scripts[0].analyzedTextVersion).toBe(unpacked.scripts[0].textVersion);
    });

    it('frees the native request when planning throws', () => {
        const catalog = dql!.createCatalog();
        const session = prepare(catalog, 'select 1');
        const baseline = dql!.registeredMemory.size;
        const planSession = vi.spyOn(dql!.bindings, 'planSession').mockImplementation(() => {
            throw new Error('test failure');
        });
        const free = vi.spyOn(dql!.bindings.SessionPlanRequest.prototype, 'free');
        try {
            expect(() => plan(catalog, [session])).toThrow('test failure');
            expect(free).toHaveBeenCalledTimes(1);
            expect(dql!.registeredMemory.size).toBe(baseline);
        } finally {
            planSession.mockRestore();
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
