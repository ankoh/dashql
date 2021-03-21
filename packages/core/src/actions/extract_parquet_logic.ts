import * as proto from "@dashql/proto";
import * as utils from "../utils";
import { ActionHandle, Statement } from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class ExtractParquetActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionHandle, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public prepare(_context: ActionContext) {}
    public async execute(_context: ActionContext): Promise<void> {}
};

