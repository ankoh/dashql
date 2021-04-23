import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as proto from '@dashql/proto';
import * as model from '../model';
import * as Immutable from 'immutable';
import { ActionHandle, PlanObject, Statement } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';
import { collectTableInfo } from './table_logic';

export class ExtractActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext, _planObjects: PlanObject[]): void {}
    public willExecute(_context: ActionContext): void {}

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const xtr = instance.extractStatements.get(stmtId);
        if (!xtr) throw new Error(`missing information for extract statement ${stmtId}`);

        const logger = context.platform.logger;
        const stmt = instance.program.getStatement(this._origin.statementId);
        const name = this.buffer.nameQualified();

        // Find the loaded blob
        const state = context.platform.store.getState();
        const planState = state.core.planState;
        const blobName = xtr.dataSource();
        const blobID = planState.blobsByName.get(blobName);
        if (blobID === undefined) throw new Error(`missing blob id for blob '${blobID}'`);
        const blob = planState.objects.get(blobID) as model.BlobRef;
        if (!blob) throw new Error(`blob '${blobName}' is not registered in duckdb`);

        // Get the input file
        const getInput = async (conn: duckdb.AsyncConnection) => {
            const db = conn.instance;
            switch (blob.archiveMode) {
                case proto.analyzer.ArchiveMode.ZIP: {
                    const outPath = `blob://${this.buffer.nameQualified()}`;
                    const outId = await db.addFileBuffer(outPath, new Uint8Array());
                    await db.extractZipPath(blob.fileId, outId, xtr.dataSourceIndex());
                    return outPath;
                }
                case proto.analyzer.ArchiveMode.NONE:
                    return blob.filePath;
            }
        };

        // Handle the different extract method
        const table = await context.platform.database.use(async c => {
            let filePath: string | undefined = undefined;
            switch (xtr.method()) {
                case proto.syntax.ExtractMethodType.PARQUET: {
                    filePath = await getInput(c);
                    const text = `CREATE VIEW ${name} AS (SELECT * FROM parquet_scan('${filePath}'));`;
                    await c.runQuery(text);
                    break;
                }
                case proto.syntax.ExtractMethodType.CSV:
                default:
                    console.warn('not implemented');
                    break;
            }

            // Return plan object
            const now = new Date();
            return await collectTableInfo(c, {
                objectId: this.buffer.objectId(),
                objectType: model.PlanObjectType.TABLE,
                timeCreated: now,
                timeUpdated: now,
                nameQualified: this.buffer.nameQualified() || '',
                tableType: model.TableType.VIEW,
                columnNames: [],
                columnNameMapping: new Map(),
                columnTypes: [],
                statistics: Immutable.Map(),
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
            origin: model.LogOrigin.EXTRACT_LOGIC,
            topic: model.LogTopic.EXECUTE,
            event: model.LogEvent.OK,
            value: `extracted ${stmt.nameQualified}`,
        });
    }
}
