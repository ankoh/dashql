import * as arrow from 'apache-arrow';
import * as dashql from '@dashql/dashql-core/node';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';

import { jest } from '@jest/globals';

describe('Node Workflows', () => {
    it('hello frontend', async () => {
        const frontend = {} as any;
        frontend.beginBatchUpdate = jest.fn();
        frontend.endBatchUpdate = jest.fn();
        frontend.updateProgram = jest.fn();
        const session = dashql.workflow.createSession(frontend);

        session.updateProgram('create table foo as select 42');

        const sessionClosed = new Promise((resolve, _) => session.close(() => resolve(null)));
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

    it('hello database', async () => {
        const frontend = {} as any;
        const session = dashql.workflow.createSession(frontend);
        const query = session.runQuery('select 42::integer as v');

        const reader = arrow.RecordBatchReader.from<{ v: arrow.Int32 }>(query);
        expect(reader.isSync()).toBeTruthy();
        expect(reader.isFile()).toBeTruthy();
        const table = new arrow.Table(reader as arrow.RecordBatchFileReader);
        const rows = table.toArray();
        expect(rows.length).toEqual(1);
        expect(rows[0].v).toEqual(42);

        const sessionClosed = new Promise((resolve, _) => session.close(() => resolve(null)));
        await sessionClosed;
    });
});
