import * as Immutable from 'immutable';
import * as model from './model';
import { Platform } from './platform';
import { TaskContext } from './task';
import { TaskGraphScheduler } from './task_scheduler';

const MIN_INPUT_DELAY = 300;
const MAX_INPUT_DELAY = 1000;
const MIN_INSTANTIATION_DELAY = 100;

export class ScriptPipeline {
    /// The store
    _platform: Platform;
    /// The scheduler
    _scheduler: TaskGraphScheduler;
    /// The program text
    _programText: string;
    /// The previous program
    _program: model.Program | null;
    /// The program input
    _programInputValues: Immutable.List<any>;
    /// The previous program instance
    _programInstance: model.ProgramInstance | null;

    /// The debounce function
    _debounceFunction = this.instantiateProgram.bind(this);
    /// The debounce timeout
    _debounceTimeout: ReturnType<typeof setTimeout> | null;
    /// The last debounce trigger
    _programParsedAt: number;

    /// Constructor
    constructor(platform: Platform, scheduler: TaskGraphScheduler) {
        this._platform = platform;
        this._scheduler = scheduler;
        const store = platform.store;
        const state = store.getState().core;
        this._programText = state.script.text;
        this._program = state.program;
        this._programInputValues = state.programInputValues;
        this._programInstance = state.programInstance;
        this._debounceTimeout = null;
        this._programParsedAt = 0;
        store.subscribe(this.detectChanges.bind(this));
    }

    /// Debounce instantiation again
    protected debounceInstantiation(delta: number): void {
        if (this._debounceTimeout != null) {
            clearTimeout(this._debounceTimeout!);
        }
        this._debounceTimeout = setTimeout(this._debounceFunction, delta);
    }

    /// We parse the program with every keystroke but instantiate programs more carefully.
    /// If a user is currently writing a SQL statment, we should not rerun the sql script with every keystroke.
    ///
    /// We might want to add a heuristic to check wheather a sql query is likely very expensive at the moment.
    protected instantiateProgram(): void {
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
        const instance = this._platform.analyzer.instantiateProgram(this._programInputValues);
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
    protected detectChanges(): void {
        const next = this._platform.store.getState().core;

        // Program text changed?
        if (next.script.text !== this._programText) {
            this._programText = next.script.text;

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
        if (next.program !== this._program || next.programInputValues !== this._programInputValues) {
            this._program = next.program;
            this._programInputValues = next.programInputValues;
            if (!this._program) return;

            // Instantiate the new program if necessary
            if (
                next.programInstance &&
                next.programInstance.program == this._program &&
                next.programInstance.inputValues == this._programInputValues
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
            next.schedulerStatus == model.TaskSchedulerStatus.Idle &&
            next.programInstance &&
            (!next.plan || next.plan.programInstance !== next.programInstance)
        ) {
            this._programInstance = next.programInstance;
            this.planProgram();
            return;
        }
    }

    /// Execute a plan
    protected async planProgram(): Promise<void> {
        const plan = this._platform.analyzer.planProgram();
        if (!plan) return;

        // Schedule the plan
        const ctx = new TaskContext(this._platform, plan);
        this._scheduler.prepare(ctx);

        // Execute the plan
        await this._scheduler.execute(ctx);

        // Scheduler is ready again
        model.mutate(this._platform.store.dispatch, {
            type: model.StateMutationType.SCHEDULER_READY,
            data: null,
        });
    }
}
