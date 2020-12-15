import * as proto from "@dashql/proto";
import { Program, Statement } from "../model";
import { ProgramAction } from "./action";

export class ExtractParquetAction extends ProgramAction {
    constructor(action: proto.action.ProgramAction, program: Program, statement: Statement) {
        super(action, program, statement);
    }
};

