import { Plan, PlanObject } from '../model';
import { Platform } from '../platform';

export class TaskContext {
    /// The platform
    public readonly platform: Platform;
    /// The program
    public readonly plan: Plan;
    /// The staged objects
    public stagedObjects: PlanObject[];

    constructor(platform: Platform, plan: Plan) {
        this.platform = platform;
        this.plan = plan;
        this.stagedObjects = [];
    }
}
