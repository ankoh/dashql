import { Statement } from "../model";


class Action {
}

export class ProgramAction extends Action {
    /// The statement
    origin_statement: Statement;
    ///

    constructor(origin: Statement) {
        super();
        this.origin_statement = origin;
    }
}

export class SetupAction extends Action {
}
