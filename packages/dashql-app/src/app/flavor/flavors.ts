import type { AppSettings } from '../config/app_config.js';

/// The logo of a flavor
export interface AppFlavorLogo {
    /// The id of the symbol in the svg sprite
    symbol: string;
    /// The width of the logo relative to its height, 1 for a square mark
    aspectRatio: number;
    /// Does the logo spell out the name? The name is then not repeated next to it
    wordmark: boolean;
}

/// The features of a flavor.
/// Unlike the app settings, they are fixed by the flavor and can neither be changed by the user nor persisted.
export interface AppFlavorFeatures {
    /// Can sessions be exported as .dashql archives?
    sessionArchiveExport: boolean;
}

/// A page that a flavor will have, announced by a disabled button in the rail
export interface AppFlavorUpcomingPage {
    /// The label of the button
    label: string;
    /// The id of the icon in the svg sprite
    icon: string;
}

/// A product flavor of the app: brand identity, theme tokens and settings defaults.
/// The theme tokens live in `src/styles/flavors/<id>.css`, scoped to `:root[data-flavor="<id>"]`.
export interface AppFlavor {
    /// The flavor id, used in `?flavor=<id>` and as the `data-flavor` attribute
    id: string;
    /// The product name shown in the UI and the document title
    displayName: string;
    /// The logo
    logo: AppFlavorLogo;
    /// The tagline shown in smaller type next to the logo in the navbar of the shell, null shows none
    tagline: string | null;
    /// The favicon replacing the static favicons of the html entry pages, null keeps them
    favicon: URL | null;
    /// The features
    features: AppFlavorFeatures;
    /// The pages that are not there yet, shown as disabled buttons in the rail.
    /// A separator goes in front of every group, the first follows the workspace and the shell.
    upcomingPages: AppFlavorUpcomingPage[][];
    /// Settings layered over the settings of config.json, persisted user settings still win
    settings?: AppSettings;
}

/// The default flavor, the static html entry pages are branded for it
export const DASHQL_FLAVOR: AppFlavor = {
    id: 'dashql',
    displayName: 'DashQL',
    logo: { symbol: 'dashql', aspectRatio: 1, wordmark: false },
    tagline: null,
    favicon: null,
    features: {
        sessionArchiveExport: true,
    },
    upcomingPages: [],
};

/// The sidb flavor
export const SIDB_FLAVOR: AppFlavor = {
    id: 'sidb',
    displayName: 'SIDB',
    logo: { symbol: 'sidb', aspectRatio: 2231 / 688, wordmark: true },
    tagline: 'powered by Hyper',
    favicon: new URL('../../../static/favicons/sidb/favicon.svg?no-inline', import.meta.url),
    features: {
        sessionArchiveExport: false,
    },
    upcomingPages: [
        [
            { label: 'Ingestion', icon: 'upload_24' },
            { label: 'Transforms', icon: 'workflow_24' },
            { label: 'Indexes', icon: 'ai_model_24' },
            { label: 'PostgreSQL', icon: 'postgresql_24' },
        ],
        [
            { label: 'Catalog', icon: 'database_24' },
            { label: 'Monitoring', icon: 'pulse_24' },
            { label: 'Governance', icon: 'shield_lock_24' },
            { label: 'Sharing', icon: 'share_android_24' },
        ],
    ],
};

/// All flavors by id
export const FLAVORS: Map<string, AppFlavor> = new Map([DASHQL_FLAVOR, SIDB_FLAVOR].map(f => [f.id, f]));

/// Layer the settings of a flavor over the settings of the app config
export function applyFlavorSettings(settings: AppSettings | undefined, flavor: AppFlavor): AppSettings | undefined {
    if (flavor.settings == null) {
        return settings;
    }
    return { ...(settings ?? {}), ...flavor.settings };
}
