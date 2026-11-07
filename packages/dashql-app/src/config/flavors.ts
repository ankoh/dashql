import type { AppSettings } from './app_config.js';

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
    type: 'upcoming';
    /// The label of the button
    label: string;
    /// The id of the icon in the svg sprite
    icon: string;
}

/// A page of the rail, the workspace, the shell or a page that is not there yet
export type AppFlavorRailPage = { type: 'workspace' } | { type: 'shell' } | AppFlavorUpcomingPage;

const WORKSPACE: AppFlavorRailPage = { type: 'workspace' };
const SHELL: AppFlavorRailPage = { type: 'shell' };

/// A page that is not there yet
function upcoming(label: string, icon: string): AppFlavorUpcomingPage {
    return { type: 'upcoming', label, icon };
}

/// A product flavor of the app: brand identity, theme tokens and settings defaults.
/// The theme tokens live in `@ankoh/dashql-ui/styles/flavors/<id>.css`, scoped to `:root[data-flavor="<id>"]`.
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
    /// The pages of the rail in groups with a separator between them.
    /// The pages that are not there yet are disabled buttons.
    railPages: AppFlavorRailPage[][];
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
    railPages: [[WORKSPACE, SHELL]],
};

/// The Database.com flavor
export const DBCOM_FLAVOR: AppFlavor = {
    id: 'dbcom',
    displayName: 'Database.com',
    logo: { symbol: 'dbcom_wordmark', aspectRatio: 6135 / 714, wordmark: true },
    tagline: 'powered by Hyper',
    favicon: new URL('../../static/favicons/dbcom/favicon.svg?no-inline', import.meta.url),
    features: {
        sessionArchiveExport: false,
    },
    railPages: [
        [WORKSPACE, SHELL, upcoming('Ingestion', 'upload_24'), upcoming('Data Pipelines', 'workflow_24')],
        [
            upcoming('Indexes', 'tree_structure_24'),
            upcoming('AI & ML', 'ai_model_24'),
            upcoming('PostgreSQL', 'postgresql_24'),
            upcoming('Marketplace', 'apps_24'),
        ],
        [
            upcoming('Catalog', 'database_24'),
            upcoming('Monitoring', 'pulse_24'),
            upcoming('Governance', 'shield_lock_24'),
            upcoming('Sharing', 'share_android_24'),
        ],
        [upcoming('Compute', 'zap_24'), upcoming('Admin', 'settings_24')],
    ],
};

/// All flavors by id
export const FLAVORS: Map<string, AppFlavor> = new Map([DASHQL_FLAVOR, DBCOM_FLAVOR].map(f => [f.id, f]));

/// Former flavor ids that urls may still request
const FLAVOR_ALIASES: Map<string, AppFlavor> = new Map([['sidb', DBCOM_FLAVOR]]);

/// Find a flavor by its id or a former id
export function findFlavor(id: string): AppFlavor | undefined {
    return FLAVORS.get(id) ?? FLAVOR_ALIASES.get(id);
}

/// Layer the settings of a flavor over the settings of the app config
export function applyFlavorSettings(settings: AppSettings | undefined, flavor: AppFlavor): AppSettings | undefined {
    if (flavor.settings == null) {
        return settings;
    }
    return { ...(settings ?? {}), ...flavor.settings };
}
