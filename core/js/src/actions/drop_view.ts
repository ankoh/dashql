import * as proto from "@dashql/proto";
import { SetupAction } from "./action";

export class DropViewAction extends SetupAction {
    constructor(action: proto.action.SetupAction) {
        super(action);
    }
}
