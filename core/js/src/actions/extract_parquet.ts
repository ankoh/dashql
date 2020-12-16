import * as proto from "@dashql/proto";
import { Statement } from "../model";
import { ProgramAction } from "./action";

export class ExtractParquetAction extends ProgramAction {
    constructor(action: proto.action.ProgramAction, statement: Statement) {
        super(action, statement);
    }
};

