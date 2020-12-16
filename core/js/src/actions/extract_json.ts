import * as proto from "@dashql/proto";
import { Statement } from "../model";
import { ActionID, ProgramAction } from "./action";
import { ActionContext } from "./action_context";

export class ExtractJsonAction extends ProgramAction {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public async prepare(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }

    public async execute(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }

    public async teardown(_context: ActionContext): Promise<ActionID> {
        return this._action_id;
    }
};
