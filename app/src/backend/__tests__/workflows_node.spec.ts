import '../../testenv';
import * as arrow from 'apache-arrow';
import * as dashql from '@dashql/dashql-core/dist/node';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';

import { jest } from '@jest/globals';

describe('Node Workflows', () => {
    it('hello database', async () => {
        const frontend = {} as any;
        const session = dashql.workflow.createSession(frontend);
        const query = dashql.workflow.runQuery(session, 'select 42::integer as v');

        const reader = arrow.RecordBatchReader.from<{ v: arrow.Int32 }>(query);
        expect(reader.isSync()).toBeTruthy();
        expect(reader.isFile()).toBeTruthy();
        const table = new arrow.Table(reader as arrow.RecordBatchFileReader);
        const rows = table.toArray();
        expect(rows.length).toEqual(1);
        expect(rows[0].v).toEqual(42);

        const sessionClosed = new Promise<void>(resolve => dashql.workflow.closeSession(resolve, session));
        await sessionClosed;
    });

    it('hello frontend', async () => {
        const frontend = {} as any;
        frontend.updateProgram = jest.fn();
        frontend.updateProgramAnalysis = jest.fn();
        frontend.flushUpdates = jest.fn();
        const session = dashql.workflow.createSession(frontend);

        await new Promise<void>(resolve =>
            dashql.workflow.updateProgram(resolve, session, 'create table foo as select 42'),
        );

        const sessionClosed = new Promise<void>(resolve => dashql.workflow.closeSession(resolve, session));
        await sessionClosed;

        expect(frontend.updateProgram).toHaveBeenCalled();
        expect(frontend.updateProgramAnalysis).toHaveBeenCalled();
        expect(frontend.flushUpdates).toHaveBeenCalled();

        const args = frontend.updateProgram.mock.calls[0];
        expect(args[0]).toEqual(session);
        expect(args[2].byteLength).toBeGreaterThan(0);
        expect(args[3].byteLength).toBeGreaterThan(0);

        const buffer = new flatbuffers.ByteBuffer(new Uint8Array(args[3]));
        const program = proto.Program.getRootAsProgram(buffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);
    });
});
