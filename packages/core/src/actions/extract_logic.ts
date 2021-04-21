import * as proto from '@dashql/proto';
import * as model from '../model';
import { ActionHandle, PlanObject, Statement } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

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
        if (!xtr) {
            console.log(`missing information for extract statement ${stmtId}`);
            return;
        }

        const logger = context.platform.logger;
        const stmt = instance.program.getStatement(this._origin.statementId);
        console.log(`extract objectID: ${this.buffer.objectId()}`);
        console.log(`extract name: ${stmt.nameQualified}`);
        console.log(`extract method: ${proto.syntax.ExtractMethodType[xtr.method()].toString()}`);
        console.log(`extract source: ${xtr.dataSource()}`);
        console.log(`extract source index: ${xtr.dataSourceIndex()}`);

        // Find the loaded blob
        const state = context.platform.store.getState();
        const planState = state.core.planState;
        const blobID = planState.blobsByName.get(xtr.dataSource());
        if (!blobID) {
            logger.log({
                timestamp: new Date(),
                level: model.LogLevel.INFO,
                origin: model.LogOrigin.EXTRACT_LOGIC,
                topic: model.LogTopic.EXECUTE,
                event: model.LogEvent.ERROR,
                value: `missing blob ${blobID}`,
            });
        }
        const blob = planState.objects.get(blobID) as model.BlobRef;
        console.assert(blob !== undefined, 'blob id refers to unknown blob');

        switch (xtr.method()) {
            case proto.syntax.ExtractMethodType.PARQUET:
                break;
            case proto.syntax.ExtractMethodType.CSV:
                break;
            default:
                console.error('not implemented');
                break;
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
