import * as proto from '@dashql/proto';
import * as model from '../model';
import { ActionHandle, Statement, PlanObject, BlobRef } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class LoadActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext, _planObjects: PlanObject[]): void {}
    public willExecute(_context: ActionContext): void {}

    /// Load via HTTP
    protected async loadHTTP(context: ActionContext, url: string): Promise<Blob | null> {
        const http = context.platform.http;
        try {
            const resp = await http.request({ url: url });
            return new Blob([resp.response.data]);
        } catch (e) {
            return null;
        }
    }

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

        // Load the Blob
        let blob: Blob | null;
        switch (load.method()) {
            case proto.syntax.LoadMethodType.HTTP:
                blob = await this.loadHTTP(context, load.url());
                break;
            default:
                console.error('not implemented');
                // XXX
                return;
        }
        if (!blob) {
            this.status = proto.action.ActionStatusCode.FAILED;
        }

        // Register as blob in database
        const db = context.platform.database;
        const blobPath = `blob://${this.buffer.nameQualified()}`;
        const fileId = await db.use(c => c.instance.addFileBlob(blobPath, blob));

        // Create plan object
        const now = new Date();
        const blobRef: BlobRef = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.BLOB,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: this.buffer.nameQualified() || '',
            filePath: blobPath,
            fileId: fileId,
            archiveMode: load.archive(),
        };

        // Store as plan object
        const store = context.platform.store;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [blobRef],
        });
    }
}
