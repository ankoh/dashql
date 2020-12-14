import { Program } from "../model";
import { SetupAction } from "./action";

export class DropVizAction extends SetupAction {
    constructor(program: Program) {
        super(program);
    }
}
