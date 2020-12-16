import * as proto from "@dashql/proto";
import { ProgramAction } from "./action";
import { Statement } from "../model";
import { ActionContext } from "./action_context";

export class ParameterAction extends ProgramAction {
    constructor(action: proto.action.ProgramAction, statement: Statement) {
        super(action, statement);
    }

    async prepare(_context: ActionContext): Promise<proto.action.ActionStatusCode> {
        return proto.action.ActionStatusCode.COMPLETED;
    }

    async execute(_context: ActionContext): Promise<proto.action.ActionStatusCode> {

        return proto.action.ActionStatusCode.COMPLETED;
    }

    async teardown(_context: ActionContext): Promise<proto.action.ActionStatusCode> {
        return proto.action.ActionStatusCode.COMPLETED;
    }
};
