import * as proto from "@dashql/proto";
import { ActionID, ProgramActionLogic } from "./action_logic";
import { Statement } from "../model";
import { ActionContext } from "./action_context";

export class ParameterActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public async execute(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }
};
