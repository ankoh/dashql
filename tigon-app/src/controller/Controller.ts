import * as HTTP from '../utils/HTTP';
import * as Store from '../store';
import { LoggableError } from '../utils/Error';
import { Logger } from './Logger';

// The worker interval
const workerIntervalMS = 400;

// A controller
export class Controller {
    // The Store
    public store: Store.ReduxStore;
    // The logger
    public logger: Logger;

    // The worker timeout
    protected workerTimer: number | null;

    // Constructor
    constructor(store: Store.ReduxStore, logger: Logger) {
        this.store = store;
        this.logger = logger;
        this.workerTimer = null;
    }

    // Init the controller
    public init() {
        // Load app config
        HTTP.loadFromPublic<Store.AppConfig>('config.json')
            .then(config => {
                const knownServerCount = config.knownServers ? config.knownServers.length : 0;
                this.store.dispatch(Store.configureApp(config));
                this.logger.info(`loaded application config (${knownServerCount} servers)`);
            })
            .catch(error => {
                if (error instanceof LoggableError) {
                    this.logger.storeError(error);
                }
            });

        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }

    // Run a lab query
    public runLabQuery() {
        // Get state
        const state = this.store.getState();
        if (state.selectedServer == null) {
            this.logger.warning(`tried to run query without selected server`);
            return;
        }

        // Get server config
        const config = state.serverConfigs.get(state.selectedServer);
        if (config == null) {
            this.logger.warning(`tried to run query without server configuration`);
            return;
        }

        this.store.dispatch(Store.startLabQuery());
    }

    // Abort a lab query
    public abortLabQuery() {
        // TODO
        this.store.dispatch(Store.abortLabQuery());
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

