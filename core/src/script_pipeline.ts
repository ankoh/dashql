import * as Immutable from 'immutable';
import * as model from './model';
import { Platform } from './platform';
import { ActionGraphScheduler } from './action_scheduler';

const MIN_INPUT_DELAY = 100;
const MAX_INPUT_DELAY = 1000;
const MIN_INSTANTIATION_DELAY = 100;

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

    /// The debounce function
    _debounceFunction = this.instantiateProgram.bind(this);
    /// The debounce timeout
    _debounceTimeout: ReturnType<typeof setTimeout> | null;
    /// The last debounce trigger
    _programParsedAt: number;

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
        this._debounceTimeout = null;
        this._programParsedAt = 0;
        store.subscribe(this.detectChanges.bind(this));
    }

    /// Debounce instantiation again
    protected debounceInstantiation(delta: number) {
        if (this._debounceTimeout != null) {
            clearTimeout(this._debounceTimeout!);
        }
        this._debounceTimeout = setTimeout(this._debounceFunction, delta);
    }

    /// We parse the program with every keystroke but instantiate programs more carefully.
    /// If a user is currently writing a SQL statment, we should not rerun the sql script with every keystroke.
    ///
    /// We might want to add a heuristic to check wheather a sql query is likely very expensive at the moment.
    protected instantiateProgram() {
        if (!this._program) return;
        const nowMS = new Date().getTime();

        // Has a program been instantiated before?
        if (this._programInstance) {
            const lastInstantiation = this._programInstance.createdAt.getTime();
            const lastErrorCount = this._programInstance.program.buffer.errorsLength();

            // Wait at least MIN_INPUT_DELAY_MS after last input
            let deltaMS = nowMS - this._programParsedAt;
            if (deltaMS < MIN_INPUT_DELAY) {
                this.debounceInstantiation(MIN_INPUT_DELAY - deltaMS);
                return;
            }
            // Wait at least MIN_DEBOUNCE_TIME after last instantiation
            deltaMS = nowMS - lastInstantiation;
            if (deltaMS < MIN_INSTANTIATION_DELAY) {
                this.debounceInstantiation(MIN_INSTANTIATION_DELAY - deltaMS);
                return;
            }
            // Are there more errors than before?
            if (this._program.buffer.errorsLength() > lastErrorCount) {
                this.debounceInstantiation(MAX_INPUT_DELAY - deltaMS);
                return;
            }
        }

        // Clear timeout
        if (this._debounceTimeout != null) {
            clearTimeout(this._debounceTimeout!);
        }

        // Instantiate the new program
        const instance = this._platform.analyzer.instantiateProgram(this._programParameters);
        // Instantiation failed?
        // XXX log error
        if (!instance) return;

        // Otherwise store the new instance in redux
        model.mutate(this._platform.store.dispatch, {
            type: model.StateMutationType.SET_PROGRAM_INSTANCE,
            data: instance,
        });
    }

    /// Handler to detect changes
    protected detectChanges() {
        const next = this._platform.store.getState().core;

        // Program text changed?
        if (next.programText !== this._programText) {
            this._programText = next.programText;

            // Parse the new program if necessary
            if (next.program && next.program.text == this._programText) {
                // Program can be replaced directly (might be the result of a rewrite)
                this._program = next.program;
            } else {
                this._programParsedAt = new Date().getTime();
                const program = this._platform.analyzer.parseProgram(this._programText);
                model.mutate(this._platform.store.dispatch, {
                    type: model.StateMutationType.SET_PROGRAM,
                    data: program,
                });
                return;
            }
        }

        // Program or parameters changed?
        if (next.program !== this._program || next.programParameters !== this._programParameters) {
            this._program = next.program;
            this._programParameters = next.programParameters;
            if (!this._program) return;

            // Instantiate the new program if necessary
            if (
                next.programInstance &&
                next.programInstance.program == this._program &&
                next.programInstance.parameters == this._programParameters
            ) {
                // Instance can be replaced directly (might be the result of a rewrite)
                this._programInstance = next.programInstance;
            } else {
                // Debounce the program instantiation
                this.instantiateProgram();
                return;
            }
        }

        // Scheduler became idle and there is a program pending?
        // This is also checked if everything is changed at once.
        if (
            next.schedulerStatus == model.ActionSchedulerStatus.Idle &&
            next.programInstance &&
            (!next.plan || next.plan.programInstance !== next.programInstance)
        ) {
            this._programInstance = next.programInstance;
            this.planProgram();
            return;
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
