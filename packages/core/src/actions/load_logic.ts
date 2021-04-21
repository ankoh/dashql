import * as proto from '@dashql/proto';
import { ActionHandle, Statement, PlanObject } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class LoadActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext, _planObjects: PlanObject[]): void {}
    public willExecute(_context: ActionContext): void {}

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const load = instance.loadStatements.get(stmtId);
        if (!load) {
            console.log(`missing information for load statement ${stmtId}`);
            return;
        }
        const stmt = instance.program.getStatement(this._origin.statementId);

        console.log(`load objectID: ${this.buffer.objectId()}`);
        console.log(`load name: ${stmt.nameQualified}`);
        console.log(`load method: ${proto.syntax.LoadMethodType[load.method()].toString()}`);
        console.log(`load url: ${load.url()}`);
        console.log(`load archive: ${proto.analyzer.ArchiveMode[load.archive()].toString()}`);

        const http = context.platform.http;
        try {
            await http.request({ url: load.url() });
        } catch (e) {
            this.status = proto.action.ActionStatusCode.FAILED;
        }
    }
}
