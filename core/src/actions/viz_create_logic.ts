import * as proto from "@dashql/proto";
import * as webdb from "@dashql/webdb/dist/webdb_async";
import { ActionID, Statement } from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class CreateVizActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public async execute(context: ActionContext): Promise<ActionID> {
        const db = context.platform.database;
        await db.use(async (c: webdb.AsyncWebDBConnection) => {
            const result = await c.runQuery(`SELECT * FROM ${this.buffer.targetNameShort()}`);
            const chunkIter = new webdb.QueryResultChunkStream(c, result);
            while (await chunkIter.next()) {
                console.log(`rows ${chunkIter.rowCount} columns ${chunkIter.columnCount}`);
                chunkIter.iterateNumberColumn(0, (row: number, v: number | null) => {
                    console.log(`[${row}] ${v}`);
                });
            }
        });

        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};
