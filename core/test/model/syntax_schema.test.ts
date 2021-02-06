import { analyzer, model } from '../../';
import * as path from 'path';
import * as proto from '@dashql/proto';
import schema = model.schema;
import sx = proto.syntax;

import Key = proto.syntax.AttributeKey;

var analyzerBindings: analyzer.AnalyzerBindings;

beforeAll(async () => {
    analyzerBindings = new analyzer.Analyzer({}, path.resolve(__dirname, '../../src/analyzer/analyzer_wasm_node.wasm'));
    await analyzerBindings.init();
});

beforeEach(async () => {
    analyzerBindings.reset();
});

describe('Statement schema', () => {
    test('simple load statement', () => {
        const program = analyzerBindings.parseProgram(`
            LOAD weather_csv FROM http (
                url = 'https://localhost/test'
            );
        `);
        expect(program.buffer.errorsLength()).toEqual(0);
        expect(program.buffer.statementsLength()).toEqual(1);
        const stmt = program.getStatement(0);

        // Fully matching 
        {
            const method = schema.enumNode(sx.NodeType.ENUM_DASHQL_LOAD_METHOD_TYPE, 0);
            const url = schema.stringNode();
            stmt.matchSchema(schema.objectNode(sx.NodeType.OBJECT_DASHQL_LOAD, {
                [Key.DASHQL_LOAD_METHOD]: method,
                [Key.DASHQL_OPTION_URL]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: url
                }),
            }));
            expect(method.matching).toEqual(schema.Matching.MATCHED);
            expect(method.value).toEqual(sx.LoadMethodType.HTTP);
            expect(url.matching).toEqual(schema.Matching.MATCHED);
            expect(url.value).toEqual("'https://localhost/test'");
        }

        // Type mismatch 
        {
            const method = schema.enumNode(sx.NodeType.ENUM_DASHQL_LOAD_METHOD_TYPE, 0);
            const url = schema.numberNode();
            stmt.matchSchema(schema.objectNode(sx.NodeType.OBJECT_DASHQL_LOAD, {
                [Key.DASHQL_LOAD_METHOD]: method,
                [Key.DASHQL_OPTION_URL]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: url
                }),
            }));
            expect(method.matching).toEqual(schema.Matching.MATCHED);
            expect(method.value).toEqual(sx.LoadMethodType.HTTP);
            expect(url.matching).toEqual(schema.Matching.TYPE_MISMATCH);
        }

        // Missing 
        {
            const method = schema.enumNode(sx.NodeType.ENUM_DASHQL_LOAD_METHOD_TYPE, 0);
            const url = schema.numberNode();
            stmt.matchSchema(schema.objectNode(sx.NodeType.OBJECT_DASHQL_LOAD, {
                [Key.DASHQL_LOAD_METHOD]: method,
                [Key.DASHQL_OPTION_URL]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_ALIAS_NAME]: url
                }),
            }));
            expect(method.matching).toEqual(schema.Matching.MATCHED);
            expect(method.value).toEqual(sx.LoadMethodType.HTTP);
            expect(url.matching).toEqual(schema.Matching.MISSING);
        }
    });

    test('viz position short', () => {
        const r = analyzerBindings.parseProgram(`
            VIZ weather_avg USING LINE (
                pos = (x = 1, y = 2, w = 4, h = 15)
            )
        `);
        const p = r.buffer;
        expect(p.errorsLength()).toEqual(0);
        expect(p.statementsLength()).toEqual(1);
        const stmt = r.getStatement(0);

        let posX = schema.stringNode();
        let posY = schema.stringNode();
        let posW = schema.stringNode();
        let posH = schema.stringNode();

        stmt.matchSchema(schema.objectNode(sx.NodeType.OBJECT_DASHQL_VIZ, {
            [Key.DASHQL_OPTION_POSITION]: schema.optionNode({
                [Key.DASHQL_OPTION_X]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: posX,
                }),
                [Key.DASHQL_OPTION_Y]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: posY,
                }),
                [Key.DASHQL_OPTION_W]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: posW,
                }),
                [Key.DASHQL_OPTION_H]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: posH,
                }),
                [Key.DASHQL_OPTION_WIDTH]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: posW,
                }),
                [Key.DASHQL_OPTION_HEIGHT]: schema.objectNode(sx.NodeType.OBJECT_SQL_CONST, {
                    [Key.SQL_CONST_VALUE]: posH,
                }),
            }),
        }));

        expect(posX.matching).toEqual(schema.Matching.MATCHED);
        expect(posY.matching).toEqual(schema.Matching.MATCHED);
        expect(posW.matching).toEqual(schema.Matching.MATCHED);
        expect(posH.matching).toEqual(schema.Matching.MATCHED);
    });
});
