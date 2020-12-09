import { ProgramAction } from "./action";
import { Statement } from "../model";

export class ParameterAction extends ProgramAction {
    constructor(origin: Statement) {
        super(origin);
    }
};
