import { analyzer, model } from '../../src/';
import { Analyzer } from '../../src/index_browser';
import * as proto from '@dashql/proto';
import schema = model.schema;
import sx = proto.syntax;

import Key = proto.syntax.AttributeKey;

let az: analyzer.AnalyzerBindings;

beforeAll(async () => {
    az = new Analyzer({}, '/static/analyzer_wasm.wasm');
    await az.init();
});

beforeEach(async () => {
    az.reset();
});

describe('Statement schema', () => {
    it('simple fetch statement', () => {
        const program = az.parseProgram(`
            FETCH weather_csv FROM http (
                url = 'https://localhost/test'
            );
        `);
        expect(program.buffer.errorsLength()).toEqual(0);
        expect(program.buffer.statementsLength()).toEqual(1);
        const stmt = program.getStatement(0);

        // Fully matching
        {
            const method = schema.enumNode(sx.NodeType.ENUM_DASHQL_FETCH_METHOD_TYPE, 0);
            const url = schema.stringNode();
            stmt.matchSchema(
                schema.objectNode(sx.NodeType.OBJECT_DASHQL_FETCH, {
                    [Key.DASHQL_FETCH_METHOD]: method,
                    [Key.DASHQL_OPTION_URL]: url,
                }),
            );
            expect(method.matching).toEqual(schema.Matching.MATCHED);
            expect(method.value).toEqual(sx.FetchMethodType.HTTP);
            expect(url.matching).toEqual(schema.Matching.MATCHED);
            expect(url.value).toEqual("'https://localhost/test'");
        }

        // Type mismatch
        {
            const method = schema.enumNode(sx.NodeType.ENUM_DASHQL_FETCH_METHOD_TYPE, 0);
            const url = schema.numberNode();
            stmt.matchSchema(
                schema.objectNode(sx.NodeType.OBJECT_DASHQL_FETCH, {
                    [Key.DASHQL_FETCH_METHOD]: method,
                    [Key.DASHQL_OPTION_URL]: url,
                }),
            );
            expect(method.matching).toEqual(schema.Matching.MATCHED);
            expect(method.value).toEqual(sx.FetchMethodType.HTTP);
            expect(url.matching).toEqual(schema.Matching.TYPE_MISMATCH);
        }

        // Missing
        {
            const method = schema.enumNode(sx.NodeType.ENUM_DASHQL_FETCH_METHOD_TYPE, 0);
            const url = schema.numberNode();
            stmt.matchSchema(
                schema.objectNode(sx.NodeType.OBJECT_DASHQL_FETCH, {
                    [Key.DASHQL_FETCH_METHOD]: method,
                    [Key.DASHQL_OPTION_X]: url,
                }),
            );
            expect(method.matching).toEqual(schema.Matching.MATCHED);
            expect(method.value).toEqual(sx.FetchMethodType.HTTP);
            expect(url.matching).toEqual(schema.Matching.MISSING);
        }
    });
});
