import { DashQLCoreBindings } from "../core_bindings";
import { Plan } from "../model";

export class ActionContext {
    /// The bindings
    _bindings: DashQLCoreBindings;
    /// The program
    _plan: Plan;

    constructor(bindings: DashQLCoreBindings, plan: Plan) {
        this._bindings = bindings;
        this._plan = plan;
    }
};
