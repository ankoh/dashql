import { Plan } from '../model';
import { Platform } from '../platform';

export class ActionContext {
    /// The platform
    _platform: Platform;
    /// The program
    _plan: Plan;

    constructor(platform: Platform, plan: Plan) {
        this._platform = platform;
        this._plan = plan;
    }

    /// Get the platform
    public get platform() {
        return this._platform;
    }
    /// Get the plan
    public get plan() {
        return this._plan;
    }
}
