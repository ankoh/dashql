import { Statement } from "../model";

class Action {
}

export class ProgramAction extends Action {
    /// The origin statement
    origin: Statement;

    constructor(origin: Statement) {
        super();
        this.origin = origin;
    }
}

export class SetupAction extends Action {}
