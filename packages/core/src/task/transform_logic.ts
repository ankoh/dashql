// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import { ADD_BLOB, BinaryObject, persistBinaryObject, readBinaryObjectAsBuffer, registerBinaryObject } from '../model';
import { TaskHandle, Statement } from '../model';
import { ProgramTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';

interface TransformOptions {
    expression?: string;
}

export class TransformTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: Statement) {
        super(task_id, task, statement);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}

    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const instance = ctx.planContext.plan?.programInstance;
        const stmtId = this._origin.statementId;
        const transform = instance?.transformStatements.get(stmtId);
        if (!transform) throw new Error(`missing information for transform statement ${stmtId}`);

        // Find the loaded blob
        const blobName = transform.dataSource()!;
        const blobID = ctx.planContext.blobsByName.get(blobName);
        if (blobID === undefined) throw new Error(`missing blob id for blob '${blobName}'`);

        // Parse transform options
        const extra = JSON.parse(transform.extra() || '') as TransformOptions;

        // Evaluate a jmespath
        const input = ctx.planContext.blobs.get(blobID)!;
        const inputBuffer = new Uint8Array(await readBinaryObjectAsBuffer(input));
        const jp = await ctx.jmespath();
        const result = await jp.evaluateUTF8(extra.expression || '.', inputBuffer);

        // Persist binary object
        const now = new Date();
        const name = this.buffer.nameQualified()!;
        const obj: BinaryObject = await persistBinaryObject({
            objectId: this.buffer.objectId(),
            timeCreated: now,
            timeUpdated: now,
            nameQualified: name || '',
            dataSize: result.byteLength,
            dataBuffer: result,
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
