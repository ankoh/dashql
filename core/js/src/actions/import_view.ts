import { Program } from "../model";
import { SetupAction } from "./action";

export class ImportViewAction extends SetupAction {
    constructor(program: Program) {
        super(program);
    }
}
