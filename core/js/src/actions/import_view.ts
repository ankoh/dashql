import * as proto from "@dashql/proto";
import { SetupAction } from "./action";

export class ImportViewAction extends SetupAction {
    constructor(action: proto.action.SetupAction) {
        super(action);
    }
}
