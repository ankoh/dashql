// Injected at build time (Vite define).
export const DASHQL_BUILD_MODE: string = process.env.DASHQL_BUILD_MODE!;
export const DASHQL_VERSION: string = process.env.DASHQL_VERSION!;
export const DASHQL_GIT_COMMIT: string = process.env.DASHQL_GIT_COMMIT!;
export const HYPERDB_WASM_VERSION: string = process.env.HYPERDB_WASM_VERSION!;

/// The URL of the stable release manifest
export const DASHQL_STABLE_RELEASE_MANIFEST = new URL("https://get.dashql.app/stable.json");
/// The URL of the latest release manifest
export const DASHQL_LATEST_RELEASE_MANIFEST = new URL("https://get.dashql.app/latest.json");

export function isDebugBuild() {
    return DASHQL_BUILD_MODE == "development";
}

/// The filename extension for archive files
export const DASHQL_ARCHIVE_FILENAME_EXT = "dashql";
