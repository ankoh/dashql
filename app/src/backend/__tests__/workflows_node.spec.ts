import * as dashql from '@dashql/dashql-core/node';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';

import { jest } from '@jest/globals';

describe('Node Workflows', () => {
    it('hello workflows', async () => {
        dashql.workflow.configureDefault();

        const frontend = {} as any;
        frontend.beginBatchUpdate = jest.fn();
        frontend.endBatchUpdate = jest.fn();
        frontend.updateProgram = jest.fn();
        const session = dashql.workflow.createSession(frontend);

        session.updateProgram('create table foo as select 42');

        const sessionClosed = new Promise((resolve, _) => {
            session.close(() => resolve(null));
        });
        await sessionClosed;

        expect(frontend.beginBatchUpdate).toHaveBeenCalledWith(session.sessionId);
        expect(frontend.endBatchUpdate).toHaveBeenCalledWith(session.sessionId);
        expect(frontend.updateProgram).toHaveBeenCalled();

        const args = frontend.updateProgram.mock.calls[0];
        expect(args[0]).toEqual(session.sessionId);
        expect(args[1].byteLength).toBeGreaterThan(0);

        const buffer = new flatbuffers.ByteBuffer(new Uint8Array(args[1]));
        const program = proto.Program.getRootAsProgram(buffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);
    });
});
