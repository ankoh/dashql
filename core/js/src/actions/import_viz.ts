import { Program } from "../model";
import { SetupAction } from "./action";

export class ImportVizAction extends SetupAction {
    constructor(program: Program) {
        super(program);
    }
}
