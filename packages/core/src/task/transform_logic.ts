// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import { ADD_BLOB } from '../model';
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
        const blob = ctx.planContext.blobs.get(blobID)!;
        const buffer = new Uint8Array(await blob.blob.arrayBuffer());
        const jp = await ctx.jmespath();
        const result = await jp.evaluateUTF8(extra.expression || '.', buffer);
        const resultBlob = new Blob([result]);

        // Register the file handle in DuckDB
        const name = this.buffer.nameQualified()!;
        await ctx.database.use(async c => await c.instance.registerFileHandle(name, resultBlob));

        // Build the plan object
        const now = new Date();

        // Store as plan object
        ctx.planContextDiff.push({
            type: ADD_BLOB,
            data: {
                objectId: this.buffer.objectId(),
                timeCreated: now,
                timeUpdated: now,
                nameQualified: name || '',
                blob: resultBlob,
                archiveMode: proto.analyzer.ArchiveMode.NONE,
            },
        });
    }
}
