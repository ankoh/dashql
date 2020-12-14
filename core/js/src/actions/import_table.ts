import { Program } from "../model";
import { SetupAction } from "./action";

export class ImportTableAction extends SetupAction {
    constructor(program: Program) {
        super(program);
    }
}
