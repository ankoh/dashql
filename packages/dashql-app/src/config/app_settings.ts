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
}
