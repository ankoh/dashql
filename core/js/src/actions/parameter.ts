import * as proto from "@dashql/proto";
import { ProgramAction } from "./action";
import { Statement } from "../model";

export class ParameterAction extends ProgramAction {
    constructor(action: proto.action.ProgramAction, statement: Statement) {
        super(action, statement);
    }
};
