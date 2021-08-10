// Copyright (c) 2021 The DashQL Authors

import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as proto from '@dashql/proto';
import * as model from '../model';
import { TaskHandle, Statement } from '../model';
import { ADD_TABLE } from '../model/plan_context';
import { ProgramTaskLogic } from './task_logic';
import { TaskExecutionContext } from './task_execution_context';
import { collectTableInfo } from './table_logic';

export class LoadTaskLogic extends ProgramTaskLogic {
    constructor(task_id: TaskHandle, task: proto.task.ProgramTask, statement: Statement) {
        super(task_id, task, statement);
    }

    public prepare(_ctx: TaskExecutionContext): void {}
    public willExecute(_ctx: TaskExecutionContext): void {}

    public async execute(ctx: TaskExecutionContext): Promise<void> {
        const instance = ctx.planContext.plan.programInstance;
        const stmtId = this._origin.statementId;
        const xtr = instance.loadStatements.get(stmtId);
        if (!xtr) throw new Error(`missing information for load statement ${stmtId}`);

        const stmt = instance.program.getStatement(this._origin.statementId);
        const name = this.buffer.nameQualified();

        // Find the loaded blob
        const blobName = xtr.dataSource();
        const blobID = ctx.planContext.blobsByName.get(blobName);
        if (blobID === undefined) throw new Error(`missing blob id for blob '${blobID}'`);
        const blob = ctx.planContext.blobs.get(blobID);
        if (!blob) throw new Error(`blob '${blobName}' is not registered in duckdb`);

        // Get the input file
        const extractIfNeeded = async (conn: duckdb.AsyncConnection) => {
            const db = conn.instance;
            switch (blob.archiveMode) {
                case proto.analyzer.ArchiveMode.ZIP: {
                    const outPath = this.buffer.nameQualified() || '';
                    await db.registerFileBuffer(outPath, new Uint8Array());
                    await db.extractZipPath(blob.nameQualified, outPath, xtr.dataSourceIndex());
                    return outPath;
                }
                case proto.analyzer.ArchiveMode.NONE:
                    return blob.nameQualified;
            }
        };

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
        const table = await ctx.database.use(async c => {
            const filePath = await extractIfNeeded(c);
            let tableType: model.TableType;
            switch (xtr.method()) {
                case proto.syntax.LoadMethodType.PARQUET:
                    await c.runQuery(`CREATE VIEW ${name} AS (SELECT * FROM parquet_scan('${filePath}'));`);
                    tableType = model.TableType.VIEW;
                    break;
                case proto.syntax.LoadMethodType.JSON:
                    await c.importJSONFromPath(filePath, {
                        schema: qSchema,
                        name: qName,
                    });
                    tableType = model.TableType.TABLE;
                    break;
                case proto.syntax.LoadMethodType.CSV:
                    await c.importCSVFromPath(filePath, {
                        schema: qSchema,
                        name: qName,
                    });
                    tableType = model.TableType.TABLE;
                    break;
                default:
                    console.warn('not implemented');
                    break;
            }

            // Return plan object
            const now = new Date();
            return await collectTableInfo(c, {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.TABLE_SUMMARY,
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.nameQualified() || '',
                tableType,
                columnNames: [],
                columnNameMapping: new Map(),
                columnTypes: [],
                filePath: filePath,
            });
        });
        if (table) {
            ctx.planContextDiff.push({
                type: ADD_TABLE,
                data: table,
            });
        }

        ctx.log.pushBack({
            timestamp: new Date(),
            level: model.LogLevel.INFO,
            origin: model.LogOrigin.LOAD_LOGIC,
            topic: model.LogTopic.EXECUTE,
            event: model.LogEvent.OK,
            value: `loaded ${stmt.nameQualified}`,
        });
    }
}
