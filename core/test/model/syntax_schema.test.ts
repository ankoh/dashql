import { beforeAll, beforeEach, describe, test, expect } from '@jest/globals';
import { analyzer, model } from '../../src/index_node';
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
});
