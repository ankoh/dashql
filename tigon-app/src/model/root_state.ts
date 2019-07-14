import * as Immutable from 'immutable';
import { DataSource } from './data_source';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

// A view
export enum RootView {
    DATA_MODEL = 0,
    EXPLORER = 1,
    WORKBOOK = 2,
    LIBRARY = 3,
}

// A connection protocol
export enum ConnectionProtocol {
    CP_HTTP = "http",
    CP_HTTPS = "https"
}

// A connection status
export enum ConnectionStatus {
    CS_UNDEFINED = 0,
    CS_CONNECTED = 1,
    CS_DISCONNECTED = 2,
}

// A log level
export enum LogLevel {
    LL_UNDEFINED = 0,
    LL_DEBUG = 1,
    LL_INFO = 2,
    LL_WARNING = 3,
    LL_ERROR = 4,
}

// A data viz type
export enum DataVizType {
    DVT_TABLE = 0,
    DVT_CHART = 1,
}

// ---------------------------------------------------------------------------
// State Model
// ---------------------------------------------------------------------------

// An application config
export class AppConfig {
    public knownServers?: ServerConfig[]
}

// A parameter of a data source
export class QueryParameter {
    public title: string = "";
    public variable: string = "";
    public defaultValue: string = "";
}

// A option of a data source
export class QueryOption {
    public key: string = "";
    public value: string = "";
}

// A data source
export class Query {
    public id?: number;
    public name?: string;
    public template: string[] = [];
    public parameters: QueryParameter[] = [];
    public options: QueryOption[] = [];
}

// The server connection info
export class ConnectionInfo {
    public host: string = "";
    public port: number = 8000;
}

// The server configuration
export class ServerConfig {
    public static buildKey(config: ServerConfig) {
        return `${config.protocol}|${config.connection.host}|${config.connection.port}`;
    }

    public protocol: ConnectionProtocol = ConnectionProtocol.CP_HTTP;
    public connection: ConnectionInfo = new ConnectionInfo();
    public queries: Query[] = [];
}

// The server status
export class ServerInfo {
    public version: string = "";
    public lastUpdate: number = 0;
    public connectionFailures: number = 0;
    public connectionStatus: ConnectionStatus = ConnectionStatus.CS_UNDEFINED;
    public connectionHeartbeat: number = -1;
}

// A data source result column
export class QueryResultColumn {
    public columnName: string = "";
    public columnType: string = "";
    public data: any[] = [];
}

// A data source result
export class QueryResult {
    public columns: QueryResultColumn[] = [];
    public compilationTime: number = 0;
    public executionTime: number = 0;
    public resultCount: number = 0;
};

// The log entry
export class LogEntry {
    public timestamp: Date = new Date();
    public level: LogLevel = LogLevel.LL_UNDEFINED;
    public text: string = "";
}

// ---------------------------------------------------------------------------
// Root state type
// ---------------------------------------------------------------------------

// A root state
export class RootState {
    // The app config
    public appConfig: AppConfig | null;
    // The app config load is pending
    public appConfigLoadPending: boolean;

    // The server configs
    public serverConfigs: Immutable.Map<string, ServerConfig>;
    // The server status
    public serverInfos: Immutable.Map<string, ServerInfo>;
    // The selected server
    public selectedServer: string | null;

    // The log entries
    public logs: Immutable.List<LogEntry>;
    // The warnings
    public logWarnings: number;

    // The root view
    public rootView: RootView;

    // The explorer data source
    public explorerDataSource: DataSource;

    // Constructor
    constructor() {
        this.appConfig = null;
        this.appConfigLoadPending = true;
        this.serverConfigs = Immutable.Map<string, ServerConfig>();
        this.serverInfos = Immutable.Map<string, ServerInfo>();
        this.selectedServer = null;
        this.logs = Immutable.List<LogEntry>();
        this.logWarnings = 0;
        this.rootView = RootView.EXPLORER;
        this.explorerDataSource = new DataSource([
            ['', 'Tesla', 'Mercedes', 'Toyota', 'Volvo'],
            ['2019', 10, 11, 12, 13],
            ['2020', 20, 11, 14, 13],
            ['2021', 30, 15, 12, 13],
        ]);
        return;
    }
}

