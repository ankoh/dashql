import * as Immutable from 'immutable';
import * as model from './model';
import { Platform } from './platform';
import { ActionGraphScheduler } from './action_scheduler';

export class AnalyzerHooks {
    /// The store
    _platform: Platform;
    /// The scheduler
    _scheduler: ActionGraphScheduler;

    /// The scheduler status
    _schedulerStatus: model.ActionSchedulerStatus;
    /// The program text
    _programText: string;
    /// The previous program
    _program: model.Program | null;
    /// The previous program parameters
    _programParameters: Immutable.List<any>;

    /// Constructor
    constructor(platform: Platform, scheduler: ActionGraphScheduler) {
        this._platform = platform;
        this._scheduler = scheduler;
        const store = platform.store;
        const state = store.getState().core;
        this._schedulerStatus = state.schedulerStatus;
        this._programText = state.programText;
        this._program = state.program;
        this._programParameters = state.programParameters;
        store.subscribe(this.detectChanges.bind(this));
    }

    /// Handler to detect changes
    protected detectChanges() {
        const next = this._platform.store.getState().core;

        // Program text changed?
        if (next.programText !== this._programText) {
            this._programText = next.programText;
            this.parseProgram(this._programText);
            return;
        }

        // Program or parameters changed?
        if (next.program !== this._program || next.programParameters !== this._programParameters) {
            this._program = next.program;
            this._programParameters = next.programParameters;
            this.instantiateProgram(this._program, this._programParameters);
            return;
        }

        // Scheduler status changed?
        if (next.schedulerStatus !== this._schedulerStatus) {
            this._schedulerStatus = next.schedulerStatus;

            // Should we plan a new program?
            const schedulerIsIdle = this._schedulerStatus == model.ActionSchedulerStatus.Idle;
            const programNotPlanned =
                this._program &&
                (!next.plan || next.plan.program !== this._program || next.plan.parameters != this._programParameters);
            if (schedulerIsIdle && programNotPlanned) {
                this.scheduleProgram(this._program, this._programParameters);
            }
            return;
        }
    }

    /// Parse a program
    protected parseProgram(_text: string) {}

    /// Instantiate a program
    protected instantiateProgram(_program: model.Program | null, _params: Immutable.List<model.ParameterValue>) {}

    /// Plan and schedule a program
    protected scheduleProgram(_program: model.Program | null, _params: Immutable.List<model.ParameterValue>) {}
}
