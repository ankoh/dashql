import * as proto from "@dashql/proto";
import { Program } from "../model";
import { SetupAction } from "./action";

export class ImportViewAction extends SetupAction {
    constructor(action: proto.action.SetupAction, program: Program) {
        super(action, program);
    }
}
