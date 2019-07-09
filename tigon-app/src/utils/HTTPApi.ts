import * as Store from '../store';
import * as HTTP from './HTTP';

// A server version
export class ServerVersion {
    public server: string = "";
    public version: string = "";
}

// A query result
class QueryResult {
    public columns: any[] = [];
    public compilationTime: number = 0;
    public executionTime: number = 0;
    public resultCount: number = 0;
    public result: any[][] = [];
}

// Build a URL for the HTTP Api
export function buildURL(config: Store.ServerConfig): string {
    const proto = config.protocol === Store.ConnectionProtocol.CP_HTTPS ? "https" : "http";
    return `${proto}://${config.connection.host}:${config.connection.port}`;
}

// Get a version
export function getVersion(config: Store.ServerConfig): Promise<ServerVersion> {
    const url = `${buildURL(config)}/version`;
    return HTTP.loadWithTimeout<ServerVersion>(url, {}, 500);
}

// Post a query
export function postQuery(config: Store.ServerConfig, query: string): Promise<Store.QueryResult> {
    const url = `${buildURL(config)}/query`;
    return HTTP.loadWithTimeout<QueryResult>(url, {
        body: query,
        method: 'POST',
    }, 10000)
    .then((qR) => {
        const dsR = new Store.QueryResult();
        dsR.compilationTime = qR.compilationTime;
        dsR.executionTime = qR.executionTime;
        dsR.resultCount = qR.resultCount;
        dsR.columns = new Array<Store.QueryResultColumn>()
        for (let i = 0; i < Math.min(qR.columns.length, qR.result.length); ++i) {
            dsR.columns.push({
                columnName: qR.columns[i].name,
                columnType: qR.columns[i].type,
                data: qR.result[i],
            })
        }
        return dsR;
    });
}
