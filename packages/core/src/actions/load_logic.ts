import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as proto from '@dashql/proto';
import * as model from '../model';
import * as Immutable from 'immutable';
import { ActionHandle, Statement, TableStatisticsType } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import { collectTableInfo } from './table_logic';
import { Column } from 'apache-arrow';

export class LoadActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const xtr = instance.loadStatements.get(stmtId);
        if (!xtr) throw new Error(`missing information for load statement ${stmtId}`);

        const logger = context.platform.logger;
        const stmt = instance.program.getStatement(this._origin.statementId);
        const name = this.buffer.nameQualified();

        // Find the loaded blob
        const state = context.platform.store.getState();
        const planState = state.core.planState;
        const blobName = xtr.dataSource();
        const blobID = planState.blobsByName.get(blobName);
        if (blobID === undefined) throw new Error(`missing blob id for blob '${blobID}'`);
        const blob = planState.objects.get(blobID) as model.UniqueBlob;
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
        const table = await context.platform.database.use(async c => {
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
                statistics: Immutable.Map<TableStatisticsType, Column<any>>(),
                filePath: filePath,
            });
        });
        if (table) {
            const store = context.platform.store;
            model.mutate(store.dispatch, {
                type: model.StateMutationType.INSERT_PLAN_OBJECTS,
                data: [table],
            });
        }

        logger.log({
            timestamp: new Date(),
            level: model.LogLevel.INFO,
            origin: model.LogOrigin.LOAD_LOGIC,
            topic: model.LogTopic.EXECUTE,
            event: model.LogEvent.OK,
            value: `loaded ${stmt.nameQualified}`,
        });
    }
}
