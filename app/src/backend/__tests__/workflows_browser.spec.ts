import '../../testenv';
import * as arrow from 'apache-arrow';
import * as dashql from '@dashql/dashql-core/dist/wasm';
import * as proto from '@dashql/dashql-proto';
import * as flatbuffers from 'flatbuffers';

import { jest } from '@jest/globals';

describe('Wasm Workflows', () => {
    it('hello database', async () => {
        const frontend = {} as any;
        const session = await dashql.workflowCreateSession(frontend);

        const query = await dashql.workflowRunQuery(session, 'select 42::integer as v');
        const reader = arrow.RecordBatchReader.from<{ v: arrow.Int32 }>(query);
        expect(reader.isSync()).toBeTruthy();
        expect(reader.isFile()).toBeTruthy();
        const table = new arrow.Table(reader as arrow.RecordBatchFileReader);
        const rows = table.toArray();
        expect(rows.length).toEqual(1);
        expect(rows[0].v).toEqual(42);

        await dashql.workflowCloseSession(session);
    });

    it('hello frontend', async () => {
        const frontend = {} as any;
        frontend.beginBatchUpdate = jest.fn();
        frontend.endBatchUpdate = jest.fn();
        frontend.updateProgram = jest.fn();

        const session = await dashql.workflowCreateSession(frontend);
        await dashql.workflowUpdateProgram(session, 'create table foo as select 42');

        expect(frontend.beginBatchUpdate).toHaveBeenCalledWith(session);
        expect(frontend.endBatchUpdate).toHaveBeenCalledWith(session);
        expect(frontend.updateProgram).toHaveBeenCalled();

        const args = frontend.updateProgram.mock.calls[0];
        expect(args[0]).toEqual(session);
        expect(args[1].byteLength).toBeGreaterThan(0);
        expect(args[2].byteLength).toBeGreaterThan(0);

        const buffer = new flatbuffers.ByteBuffer(new Uint8Array(args[2]));
        const program = proto.Program.getRootAsProgram(buffer);
        expect(program.errorsLength()).toEqual(0);
        expect(program.statementsLength()).toEqual(1);

        await dashql.workflowCloseSession(session);
    });
});
