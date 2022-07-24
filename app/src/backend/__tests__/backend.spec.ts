import * as arrow from 'apache-arrow';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';
import { testBackends } from '../../testenv/test_backends';

import { jest } from '@jest/globals';

describe('Backend', () => {
    testBackends(backend => {
        it('hello database', async () => {
            const frontend = {} as any;
            const session = await backend.workflow.createSession(frontend);
            const query = await backend.workflow.runQuery(session, 'select 42::integer as v');
            await backend.workflow.closeSession(session);

            const reader = arrow.RecordBatchReader.from<{ v: arrow.Int32 }>(query);
            expect(reader.isSync()).toBeTruthy();
            expect(reader.isFile()).toBeTruthy();
            const table = new arrow.Table(reader as arrow.RecordBatchFileReader);
            const rows = table.toArray();
            expect(rows.length).toEqual(1);
            expect(rows[0].v).toEqual(42);
        });

        it('hello frontend', async () => {
            const frontend = {} as any;
            frontend.beginBatchUpdate = jest.fn();
            frontend.endBatchUpdate = jest.fn();
            frontend.updateProgram = jest.fn();
            frontend.updateProgramAnalysis = jest.fn();

            const session = await backend.workflow.createSession(frontend);
            await backend.workflow.updateProgram(session, 'create table foo as select 42');
            await backend.workflow.closeSession(session);

            expect(frontend.beginBatchUpdate).toHaveBeenCalledWith(session);
            expect(frontend.endBatchUpdate).toHaveBeenCalledWith(session);
            expect(frontend.updateProgram).toHaveBeenCalled();
            expect(frontend.updateProgramAnalysis).toHaveBeenCalled();

            const args = frontend.updateProgram.mock.calls[0];
            expect(args[0]).toEqual(session);
            expect(args[1].byteLength).toBeGreaterThan(0);
            expect(args[2].byteLength).toBeGreaterThan(0);

            const buffer = new flatbuffers.ByteBuffer(new Uint8Array(args[2]));
            const program = proto.Program.getRootAsProgram(buffer);
            expect(program.errorsLength()).toEqual(0);
            expect(program.statementsLength()).toEqual(1);
        });
    });
});
