import * as proto from "@dashql/proto";
import { LoggableError } from "../error";
import { ActionID, Statement, LogLevel } from "../model";
import { ProgramActionLogic } from "./action_logic";
import { ActionContext } from "./action_context";
import ActionStatusCode = proto.action.ActionStatusCode;

export class LoadHTTPActionLogic extends ProgramActionLogic {
    constructor(action_id: ActionID, action: proto.action.ProgramAction, statement: Statement) {
        super(action_id, action, statement);
    }

    public async execute(context: ActionContext): Promise<ActionID> {
        const program = context.plan.program;
        const stmt = this.origin;
        const stmt_root = stmt.root_node();

        // Build the load attribute

        // 2) Send the request

        // 3) Receive the response

        // 4) Extract the response if it's an archive

        return this.returnWithStatus(ActionStatusCode.COMPLETED);
    }
};
