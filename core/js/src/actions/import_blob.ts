import { Program } from "../model";
import { SetupAction } from "./action";

export class ImportBlobAction extends SetupAction {
    constructor(program: Program) {
        super(program);
    }
}
