import * as proto from "@dashql/proto";
import { ProgramAction } from "./action";
import { Program, Statement } from "../model";

export class ParameterAction extends ProgramAction {
    constructor(action: proto.action.ProgramAction, program: Program, statement: Statement) {
        super(action, program, statement);
    }
};
