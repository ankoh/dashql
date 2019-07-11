import * as HTTP from '../util/HTTP';
import * as Model from '../model';
import { LoggableError } from '../util/Error';
import { Logger } from './Logger';

// The worker interval
const workerIntervalMS = 400;

// A controller
export class RootController {
    // The Model
    public store: Model.ReduxStore;
    // The logger
    public logger: Logger;

    // The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: Model.ReduxStore, logger: Logger) {
        this.store = store;
        this.logger = logger;
        this.workerTimer = null;
    }

    // Init the controller
    public init() {
        // Load app config
        HTTP.loadFromPublic<Model.AppConfig>('config.json')
            .then(config => {
                const knownServerCount = config.knownServers ? config.knownServers.length : 0;
                this.store.dispatch(Model.configureApp(config));
                this.logger.info(`loaded application config (${knownServerCount} servers)`);
            })
            .catch(error => {
                if (error instanceof LoggableError) {
                    this.logger.storeError(error);
                }
            });

        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }

    // The worker function
    protected worker() {
        // Clear the worker timer
        clearTimeout(this.workerTimer || undefined);

        // TODO

        // Reschedule worker
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }
}

