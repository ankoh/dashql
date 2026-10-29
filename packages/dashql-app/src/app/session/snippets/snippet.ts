import { ConnectorType } from '../../connections/connector_info.js';

/// The folder of the snippets that load datasets, the browser lists it first
export const SNIPPET_DATASETS_FOLDER = 'datasets';

/// A self-contained SQL statement sequence that can replace the text of a script
export interface Snippet {
    /// The id of the snippet, `<category>/<name>`
    id: string;
    /// The category of the snippet, the folder of its files
    category: string;
    /// The description of the snippet, empty without one
    description: string;
    /// The connectors that the snippet runs on
    connectors: ConnectorType[];
    /// The text of the snippet per connector
    bodies: ReadonlyMap<ConnectorType, string>;
    /// The path of the file of the snippet per connector, below the snippet folder, e.g. `hyper/dates/series.sql`
    paths: ReadonlyMap<ConnectorType, string>;
}

/// The connectors of the engine folders of the snippets, `<engine>/<category>/<name>.sql`.
/// The snippets of an engine run on all of its connectors.
export const SNIPPET_ENGINE_CONNECTORS: ReadonlyMap<string, readonly ConnectorType[]> = new Map([
    ['hyper', [ConnectorType.HYPER, ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.SIDB]],
    ['trino', [ConnectorType.TRINO]],
]);

