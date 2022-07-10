import { DASHQL_PARSER } from '../../testenv';

import * as flatbuffers from 'flatbuffers';
import * as proto from '@dashql/dashql-proto';

describe('Wasm Parser', () => {
    it('hello parser', async () => {
        const programData = await DASHQL_PARSER.parse(`CREATE TABLE foo AS SELECT 42`);

        const programBuffer = new flatbuffers.ByteBuffer(programData.getData());
        const program = proto.Program.getRootAsProgram(programBuffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);

        programData.delete();
    });
});
