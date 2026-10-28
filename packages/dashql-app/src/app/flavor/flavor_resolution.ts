import { AppFlavor, DASHQL_FLAVOR, findFlavor } from './flavors.js';

/// The query parameter selecting a flavor, e.g. `?flavor=sidp`, former flavor ids are accepted as well
export const FLAVOR_QUERY_PARAMETER = 'flavor';

/// The result of resolving the flavor
export interface FlavorResolution {
    /// The resolved flavor
    flavor: AppFlavor;
    /// A requested flavor id that is not known
    unknownId?: string;
}

/// Resolve the flavor from the query parameter, DashQL is the default
export function resolveFlavor(requested: string | null): FlavorResolution {
    if (requested == null) {
        return { flavor: DASHQL_FLAVOR };
    }
    const flavor = findFlavor(requested);
    if (flavor == null) {
        return { flavor: DASHQL_FLAVOR, unknownId: requested };
    }
    return { flavor };
}

/// Get the flavor requested by the query parameter of this page, null if it requests none.
/// An unknown flavor requests the default one.
export function getRequestedFlavor(): AppFlavor | null {
    const search = new URLSearchParams(globalThis.location?.search ?? '');
    const requested = search.get(FLAVOR_QUERY_PARAMETER);
    if (requested == null) {
        return null;
    }
    const resolution = resolveFlavor(requested);
    if (resolution.unknownId !== undefined) {
        console.warn(`unknown app flavor: ${resolution.unknownId}`);
    }
    return resolution.flavor;
}

/// Select the flavor of the app.
/// The flavor requested by the url wins over the flavor of the app settings, DashQL is the default.
export function selectFlavor(requested: AppFlavor | null, settingId: string | undefined): AppFlavor {
    return requested ?? (settingId == null ? null : findFlavor(settingId)) ?? DASHQL_FLAVOR;
}

/// The url with the query parameter of a flavor, null if it already carries it.
/// The default flavor needs no query parameter.
export function withFlavorParameter(url: URL, flavor: AppFlavor): URL | null {
    if (flavor.id === DASHQL_FLAVOR.id || url.searchParams.get(FLAVOR_QUERY_PARAMETER) === flavor.id) {
        return null;
    }
    const next = new URL(url);
    next.searchParams.set(FLAVOR_QUERY_PARAMETER, flavor.id);
    return next;
}

/// The static favicons of the entry pages that a branded flavor replaced
const STATIC_FAVICONS = new WeakMap<Document, Element[]>();

/// Brand the document of an html entry page with a flavor.
/// The static entry pages carry the DashQL favicons, they are only replaced for flavors with their own
/// and restored when switching back to a flavor without.
export function applyFlavorToDocument(flavor: AppFlavor, doc: Document = document) {
    doc.documentElement.dataset.flavor = flavor.id;
    doc.title = flavor.displayName;
    doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', flavor.displayName);
    doc.head.querySelector('link[data-flavor-favicon]')?.remove();
    if (flavor.favicon != null) {
        const statics = [...doc.head.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]')];
        if (statics.length > 0) {
            STATIC_FAVICONS.set(doc, statics);
        }
        for (const link of statics) {
            link.remove();
        }
        const icon = doc.createElement('link');
        icon.rel = 'icon';
        icon.href = flavor.favicon.href;
        icon.dataset.flavorFavicon = flavor.id;
        doc.head.appendChild(icon);
    } else {
        for (const link of STATIC_FAVICONS.get(doc) ?? []) {
            doc.head.appendChild(link);
        }
        STATIC_FAVICONS.delete(doc);
    }
}
