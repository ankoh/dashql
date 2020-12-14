import { Program } from "../model";
import { SetupAction } from "./action";

export class DropBlobAction extends SetupAction {
    constructor(program: Program) {
        super(program);
    }
}
