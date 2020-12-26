import { DashQLCoreWasm, CORE_WASM_RUNTIME_STUBS, model } from '../../src/index_node';
import * as path from 'path';
import * as proto from '@dashql/proto';
import schema = model.schema;
import sx = proto.syntax;
import sxd = proto.syntax_dashql;

import Key = proto.syntax.AttributeKey;

var core: DashQLCoreWasm;

beforeAll(async () => {
    core = new DashQLCoreWasm(CORE_WASM_RUNTIME_STUBS, path.resolve(__dirname, '../../src/wasm/core_wasm_node.wasm'));
    await core.init();
});

beforeEach(async () => {
    core.resetSession();
});

describe('Statement schema', () => {
    test('simple load', async () => {
        const program = core.parseProgram(`
            LOAD weather_csv FROM http (url = 'https://localhost/test');
        `);
        expect(program.buffer.errorsLength()).toEqual(0);
        expect(program.buffer.statementsLength()).toEqual(1);
        const stmt = program.getStatement(0);

        const method = schema.enumNode(sx.NodeType.ENUM_DASHQL_LOAD_METHOD_TYPE, 0);
        const url = schema.stringNode();
        stmt.matchSchema(schema.objectNode(sx.NodeType.OBJECT_DASHQL_LOAD, {
            [Key.DASHQL_LOAD_METHOD]: method,
            [Key.DASHQL_OPTION_URL]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                [Key.SQL_CONST_VALUE]: url
            }),
        }));

        expect(method.present).toBe(true);
        expect(method.value).toBe(sxd.LoadMethodType.HTTP);
        expect(url.present).toBe(true);
        expect(url.value).toEqual("'https://localhost/test'");
    });
});
