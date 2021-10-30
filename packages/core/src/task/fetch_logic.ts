// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import { ADD_BLOB } from '../model/plan_context';
import { TaskHandle, Statement, BinaryObject, persistBinaryObject, registerBinaryObject } from '../model';
import { ProgramTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';

export class FetchTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: Statement) {
        super(task_id, task, statement);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}

    /// Fetch via HTTP
    protected async fetchHTTP(
        ctx: TaskExecutionContext,
        url: string,
        headers?: Record<string, string>,
    ): Promise<ArrayBuffer | null> {
        try {
            const resp = await ctx.http.request({
                url,
                headers,
            });
            return resp.response.data;
        } catch (e) {
            console.error(e);
            return null;
        }
    }

    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const instance = ctx.planContext.plan?.programInstance;
        const stmtId = this._origin.statementId;
        const fetch = instance?.fetchStatements.get(stmtId);
        if (!fetch) {
            console.warn(`missing information for fetch statement ${stmtId}`);
            return;
        }

        // Fetch the Blob
        let buffer: ArrayBuffer | null = null;
        switch (fetch.method()) {
            case proto.syntax.FetchMethodType.HTTP: {
                const extra = fetch.extra() ? (JSON.parse(fetch.extra()!) as any) : undefined;
                buffer = await this.fetchHTTP(ctx, fetch.url()!, extra.headers);
                break;
            }
            default:
                console.error('not implemented');
                // XXX
                return;
        }
        if (!buffer) {
            this.status = proto.task.TaskStatusCode.FAILED;
            return;
        }

        // Persist binary object
        const now = new Date();
        const name = this.buffer.nameQualified()!;
        const obj: BinaryObject = await persistBinaryObject({
            objectId: this.buffer.objectId(),
            timeCreated: now,
            timeUpdated: now,
            nameQualified: name || '',
            dataSize: buffer.byteLength,
            dataBuffer: buffer,
            dataURL: null,
            dataBlob: null,
        });

        // Register as blob in database
        const db = ctx.database;
        await registerBinaryObject(name, obj, db.instance);

        // Store as plan object
        ctx.planContextDiff.push({
            type: ADD_BLOB,
            data: obj,
        });
    }
}
