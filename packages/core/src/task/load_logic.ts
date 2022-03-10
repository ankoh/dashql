// Copyright (c) 2021 The DashQL Authors

import * as proto from '@dashql/proto';
import * as model from '../model';
import { TaskHandle, Statement } from '../model';
import { ProgramTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';

interface JSONLoadOptions {
    jmespath?: string;
}

export class LoadTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: Statement) {
        super(task_id, task, statement);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}

    public async execute(ctx: TaskExecutionContext): Promise<void> {
        if (!ctx.planContext.plan) return;

        // A Get load statment
        const instance = ctx.planContext.plan.programInstance;
        const stmtId = this._origin.statementId;
        const xtr = instance.loadStatements.get(stmtId);
        if (!xtr) throw new Error(`missing information for load statement ${stmtId}`);
        const stmt = instance.program.getStatement(this._origin.statementId);
        const name = this.buffer.nameQualified() || '';

        // Find the loaded blob
        const blobName = xtr.dataSource() || '';
        const blobID = ctx.planContext.blobsByName.get(blobName);
        if (blobID === undefined) throw new Error(`missing blob id for blob '${blobName}'`);
        const blob = ctx.planContext.blobs.get(blobID);
        if (!blob) throw new Error(`blob '${blobName}' is not registered in duckdb`);

        // XXX store this either in the flatbuffer or do via wasm.
        //     This is currently just a hack and not correct (indirections, multiple dots)
        let qSchema = 'main';
        let qName = name;
        if (name.includes('.')) {
            const split = name.split('.');
            qSchema = split[0];
            qName = split[1];
        }

        // Handle the different load method
        const conn = ctx.databaseConnection;
        const filePath = blob.nameQualified;
        let filePathTmp = null;
        let tableType: model.TableType;
        let tableScript: string | undefined = undefined;
        switch (xtr.method()) {
            // Load table from parquet?
            case proto.syntax.LoadMethodType.PARQUET:
                tableScript = `CREATE VIEW ${name} AS (SELECT * FROM parquet_scan('${filePath}'));`;
                await conn.query(tableScript);
                tableType = model.TableType.VIEW;
                break;

            // Load table from JSON?
            case proto.syntax.LoadMethodType.JSON: {
                const options = JSON.parse(xtr.extra()) as JSONLoadOptions;

                // Has jmespath expression?
                if (options.jmespath) {
                    const jm = await ctx.jmespath();
                    const data = await conn.bindings.copyFileToBuffer(filePath);
                    const transformed = jm.evaluateUTF8(options.jmespath!, data);
                    filePathTmp = '/tmp/' + filePath;
                    await conn.bindings.registerFileBuffer(filePathTmp, transformed);
                }

                // Insert JSON from path
                await conn.insertJSONFromPath(filePathTmp ?? filePath, {
                    schema: qSchema,
                    name: qName,
                } as any);
                tableType = model.TableType.TABLE;

                // Drop file if temporary
                if (filePathTmp) {
                    await conn.bindings.dropFile(filePathTmp);
                }
                break;
            }

            // Load table from CSV?
            case proto.syntax.LoadMethodType.CSV:
                await conn.insertCSVFromPath(filePath, {
                    schema: qSchema,
                    name: qName,
                });
                tableType = model.TableType.TABLE;
                break;

            // Otherwise bail out
            default:
                tableType = model.TableType.TABLE;
                console.warn('not implemented');
                break;
        }

        // Return plan object
        await ctx.database.collectTableMetadata(conn, {
            nameQualified: this.buffer.nameQualified() || '',
            tableType,
            tableID: this.buffer.objectId(),
            script: tableScript,
        });

        ctx.logger.pushBack({
            timestamp: new Date(),
            level: model.LogLevel.INFO,
            origin: model.LogOrigin.LOAD_LOGIC,
            topic: model.LogTopic.EXECUTE,
            event: model.LogEvent.OK,
            value: `loaded ${stmt.nameQualified}`,
        });
    }
}
