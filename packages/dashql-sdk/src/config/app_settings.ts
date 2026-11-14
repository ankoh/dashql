/// The settings of the app, saved with the app (storage/storage_backend.ts) and read by app_config.tsx
export interface AppSettings {
    pauseAfterAppSetup?: boolean;
    enableTableColumnPlots?: boolean;
    experimental_file_attachments?: boolean;
    /// Run the embedded HyperDB on its experimental wasm backend, applied by a restart of the app.
    /// A hyperdb-wasm without the backend starts on the default backend.
    experimental_wasm_backend?: boolean;
    narrowScreenLayout?: boolean;
    /// Lay out the app like the desktop app on macOS, with placeholders of the traffic lights, to check the layout in the browser
    macWindowLayout?: boolean;
    /// Show the labels of the buttons in a wide rail on the left
    navRailWide?: boolean;
    scriptDebugMode?: boolean;
    tableDebugMode?: boolean;
    formattingDebugMode?: boolean;
    keywordCase?: 'lower' | 'upper';
    /// Force the OAuth identity provider to re-prompt for login instead of silently reusing an
    /// existing browser session. Adds `prompt=login` to the authorization request.
    forceReLogin?: boolean;
    /// The connections that are clouds, each keeps the workbooks that the user publishes to it in its tables
    /// (docs/design/cloud.md)
    cloudConnectionIds?: string[];
    minLogLevel?: number;
    /// The id of the app flavor, the flavor query parameter of the url wins
    flavor?: string;
    /// The color scheme of the app, the one of the OS if unset
    colorScheme?: 'light' | 'dark';
    /// Is the agent on? Then agents may read, edit and run the scripts of the visible workbook through the local agent
    /// server, never those of another workbook.
    agentEnabled?: boolean;
    /// The port of the local agent server, the build's default if unset
    agentPort?: number;
    /// The harness that runs the requests of the agent, the default harness of the agent server if unset
    agentHarness?: string;
    /// The model of the harness's requests, one of the models of the harness, the harness's own default if unset
    agentModel?: string;
    /// The effort of the harness's requests, one of the efforts of the harness, the harness's own default if unset
    agentEffort?: string;
}
