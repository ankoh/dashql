import * as Immutable from 'immutable';
import * as model from './model';
import { Platform } from './platform';
import { ActionGraphScheduler } from './action_scheduler';

export class ScriptPipeline {
    /// The store
    _platform: Platform;
    /// The scheduler
    _scheduler: ActionGraphScheduler;

    /// The program text
    _programText: string;
    /// The previous program
    _program: model.Program | null;
    /// The previous program parameters
    _programParameters: Immutable.List<any>;
    /// The previous program instance
    _programInstance: model.ProgramInstance | null;

    /// Constructor
    constructor(platform: Platform, scheduler: ActionGraphScheduler) {
        this._platform = platform;
        this._scheduler = scheduler;
        const store = platform.store;
        const state = store.getState().core;
        this._programText = state.programText;
        this._program = state.program;
        this._programParameters = state.programParameters;
        this._programInstance = state.programInstance;
        store.subscribe(this.detectChanges.bind(this));
    }

    /// Handler to detect changes
    protected detectChanges() {
        const next = this._platform.store.getState().core;

        // Program text changed?
        if (next.programText !== this._programText) {
            this._programText = next.programText;

            // Parse the new program
            const program = this._platform.analyzer.parseProgram(this._programText);
            model.mutate(this._platform.store.dispatch, {
                type: model.StateMutationType.SET_PROGRAM,
                data: program,
            });
            return;
        }

        // Program or parameters changed?
        if (next.program !== this._program || next.programParameters !== this._programParameters) {
            this._program = next.program;
            this._programParameters = next.programParameters;
            if (!this._program) return;

            // Instantiate the new program
            const programInstance = this._platform.analyzer.instantiateProgram(this._programParameters);
            if (!programInstance) return;
            model.mutate(this._platform.store.dispatch, {
                type: model.StateMutationType.SET_PROGRAM_INSTANCE,
                data: programInstance,
            });
        }

        // Scheduler became idle and there is a program pending?
        if (
            next.schedulerStatus == model.ActionSchedulerStatus.Idle &&
            next.programInstance &&
            (!next.plan || next.plan.programInstance !== this._programInstance)
        ) {
            this._programInstance = next.programInstance;
            this.planProgram();
        }
    }

    /// Execute a plan
    protected async planProgram() {
        const plan = this._platform.analyzer.planProgram();
        if (!plan) return;

        // Schedule the plan
        const infos = this._scheduler.prepare(plan);
        if (infos.length == 0) return;
        model.mutate(this._platform.store.dispatch, {
            type: model.StateMutationType.SCHEDULE_PLAN,
            data: [plan, infos],
        });

        // Execute the plan
        await this._scheduler.execute();

        // Scheduler is ready again
        model.mutate(this._platform.store.dispatch, {
            type: model.StateMutationType.SCHEDULER_READY,
            data: null,
        });
    }
}
