import * as HTTP from '../utils/HTTP';
import * as HTTPApi from '../utils/HTTPApi';
import * as Store from '../store';
import { LoggableError } from '../utils/Error';
import { Logger } from './Logger';

// The worker interval
const workerIntervalMS = 400;
const serverCheckDefaultIntervalMS = 1400;
const serverCheckMaxIntervalMS = 10000;
const serverCheckBackoff = 1.25;

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

        // Post the query
        HTTPApi.postQuery(config, state.labQueryTemplate)
            .then((result: Store.QueryResult) => {
                this.logger.info(`received query result with ${result.resultCount} rows`)
                this.store.dispatch(Store.storeQueryResult(result));
            })
            .catch((err: Error) => {
                this.logger.warning(`query failed with error: ${err}`)
            });
    }

    // Abort a lab query
    public abortLabQuery() {
        // TODO
        this.store.dispatch(Store.abortLabQuery());
    }

    // Update the status of a single server
    protected updateServerStatus(key: string, config: Store.ServerConfig) {
        const state = this.store.getState();

        // Server checks not necessary?
        const prevStatus = state.serverInfos.get(key) || new Store.ServerInfo();
        const now = Date.now();
        const delta = now - prevStatus.lastUpdate;
        let threshold = serverCheckDefaultIntervalMS * Math.pow(serverCheckBackoff, prevStatus.connectionFailures);
        threshold = Math.min(threshold, serverCheckMaxIntervalMS);
        if (delta < threshold) {
            return;
        }
        const serverKey = Store.ServerConfig.buildKey(config);

        // Which protocol
        switch (config.protocol) {
            case Store.ConnectionProtocol.CP_HTTP:
            case Store.ConnectionProtocol.CP_HTTPS:
                HTTPApi.getVersion(config)
                    .then((resp) => {
                        this.store.dispatch(Store.updateServerInfo(serverKey, {
                            connectionStatus: Store.ConnectionStatus.CS_CONNECTED,
                            version: resp.version,
                        }))
                    })
                    .catch((error) => {
                        this.store.dispatch(Store.updateServerInfo(serverKey, {
                            connectionStatus: Store.ConnectionStatus.CS_DISCONNECTED,
                        }))
                    });
                break;
        }
    }

    // Update the status of all servers
    protected updateAllServerStatus(state: Store.RootState) {
        if (state.rootView === Store.RootView.SERVER_SELECTOR) {
            state.serverConfigs.forEach((config: Store.ServerConfig | undefined, key: string | undefined) => {
                if (!key || !config) { return; }
                this.updateServerStatus(key, config);
            });
        } else if (state.selectedServer != null) {
            const config = state.serverConfigs.get(state.selectedServer)
            if (config != null) {
                this.updateServerStatus(state.selectedServer, config);
            }
        }
    }

    // The worker function
    protected worker() {
        // Clear the worker timer
        clearTimeout(this.workerTimer || undefined);

        const state = this.store.getState();
        try {
            this.updateAllServerStatus(state);
        } catch(e) {
            this.logger.warning(`catched error in worker: ${e}`);
        }

        // Reschedule worker
        this.workerTimer = window.setTimeout(this.worker.bind(this), workerIntervalMS);
    }
}

