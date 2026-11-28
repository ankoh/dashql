import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';

/// The folder of the snippets that load datasets, the browser lists it first
export const SNIPPET_DATASETS_FOLDER = 'datasets';

/// A self-contained SQL statement sequence that can replace the text of a script
export interface Snippet {
    /// The id of the snippet, `<category>/<name>`
    id: string;
    /// The category of the snippet, the path of its folder in the tree of the browser, e.g. `dates` or `json/access`
    category: string;
    /// The connectors that the snippet runs on
    connectors: ConnectorType[];
    /// The text of the snippet per connector
    bodies: ReadonlyMap<ConnectorType, string>;
    /// The path of the file of the snippet per connector, starting at its root folder, e.g. `hyper/dates/series.sql`
    paths: ReadonlyMap<ConnectorType, string>;
}

/// The connectors of the root folders of the snippets, `<root>/<folders>/<name>.sql`. A root is a folder of
/// examples/snippets. The snippets of a root run on all of its connectors.
export const SNIPPET_ROOT_CONNECTORS: ReadonlyMap<string, readonly ConnectorType[]> = new Map([
    ['d360', [ConnectorType.SALESFORCE_DATA_CLOUD]],
    ['hyper', [ConnectorType.HYPER, ConnectorType.DBCOM]],
    ['trino', [ConnectorType.TRINO]],
]);
