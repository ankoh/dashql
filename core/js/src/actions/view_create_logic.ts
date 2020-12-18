import * as proto from "@dashql/proto";
import { ActionID, Statement } from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";

export class ViewCreateActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public async execute(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }
};
