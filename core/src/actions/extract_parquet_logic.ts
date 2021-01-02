import * as proto from "@dashql/proto";
import * as utils from "../utils";
import { ActionID, Statement } from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class ExtractParquetActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public async execute(_context: ActionContext): Promise<ActionID> {
        await utils.sleep(1000);
        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};

