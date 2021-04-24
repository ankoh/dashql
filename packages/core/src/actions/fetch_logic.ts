import * as proto from '@dashql/proto';
import * as model from '../model';
import { ActionHandle, Statement, PlanObject, BlobRef } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class FetchActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext, _planObjects: PlanObject[]): void {}
    public willExecute(_context: ActionContext): void {}

    /// Fetch via HTTP
    protected async fetchHTTP(context: ActionContext, url: string): Promise<ArrayBuffer | null> {
        const http = context.platform.http;
        try {
            const resp = await http.request({
                url: url,
            });
            return resp.response.data;
        } catch (e) {
            return null;
        }
    }

    public async execute(context: ActionContext): Promise<void> {
        const instance = context.plan.programInstance;
        const stmtId = this._origin.statementId;
        const fetch = instance.fetchStatements.get(stmtId);
        if (!fetch) {
            console.warn(`missing information for fetch statement ${stmtId}`);
            return;
        }

        // Fetch the Blob
        let blob: Blob | null;
        switch (fetch.method()) {
            case proto.syntax.FetchMethodType.HTTP: {
                const buffer = await this.fetchHTTP(context, fetch.url());
                blob = new Blob([buffer]);
                break;
            }
            default:
                console.error('not implemented');
                // XXX
                return;
        }
        if (!blob) {
            this.status = proto.action.ActionStatusCode.FAILED;
            return;
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
            archiveMode: fetch.archive(),
        };

        // Store as plan object
        const store = context.platform.store;
        model.mutate(store.dispatch, {
            type: model.StateMutationType.INSERT_PLAN_OBJECTS,
            data: [blobRef],
        });
    }
}
