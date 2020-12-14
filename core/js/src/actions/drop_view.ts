import { Program } from "../model";
import { SetupAction } from "./action";

export class DropViewAction extends SetupAction {
    constructor(program: Program) {
        super(program);
    }
}
