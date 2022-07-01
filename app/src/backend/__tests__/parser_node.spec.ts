import * as dashql from '@dashql/dashql-core/node';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';

describe('Node Parser', () => {
    it('hello parser', async () => {
        const ast = dashql.parser.parseScript(`
            CREATE TABLE foo AS SELECT 42
        `);
        const buffer = new flatbuffers.ByteBuffer(ast);
        const program = proto.Program.getRootAsProgram(buffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);
    });
});
