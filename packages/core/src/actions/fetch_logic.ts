import * as proto from '@dashql/proto';
import * as model from '../model';
import { ActionHandle, Statement, UniqueBlob } from '../model';
import { ProgramActionLogic } from './action_logic';
import { ActionContext } from './action_context';

export class FetchActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext): void {}
    public willExecute(_context: ActionContext): void {}

    /// Fetch via HTTP
    protected async fetchHTTP(
        context: ActionContext,
        url: string,
        headers?: Record<string, string>,
    ): Promise<ArrayBuffer | null> {
        const http = context.platform.http;
        try {
            console.log(headers);
            const resp = await http.request({
                url,
                headers,
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
                const extra = JSON.parse(fetch.extra()) as any;
                console.log(extra);
                const buffer = await this.fetchHTTP(context, fetch.url(), extra.headers);
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
        const name = this.buffer.nameQualified();

        // Register the file handle
        await db.use(async c => await c.instance.registerFileHandle(name, blob));

        // Create plan object
        const now = new Date();
        const blobRef: UniqueBlob = {
            objectId: this.buffer.objectId(),
            objectType: model.PlanObjectType.UNIQUE_BLOB,
            timeCreated: now,
            timeUpdated: now,
            nameQualified: name || '',
            blob,
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
