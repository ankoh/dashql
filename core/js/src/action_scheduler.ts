import { Plan } from "./model";

export class ActionScheduler {
    /// The plan
    plan: Plan;

    /// Constructor
    constructor(plan: Plan) {
        this.plan = plan;
    }
};
