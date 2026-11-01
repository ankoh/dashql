import * as React from 'react';
import symbols from '@ankoh/dashql-svg-symbols';
import { useLocation } from 'react-router-dom';

import { AppFlavor, DASHQL_FLAVOR } from './flavors.js';
import { applyFlavorToDocument, selectFlavor, withFlavorParameter } from './flavor_resolution.js';

interface FlavorState {
    /// The flavor of the app
    flavor: AppFlavor;
    /// The flavor requested by the url, null if the url requests none
    requested: AppFlavor | null;
    /// Select the flavor of the app settings, the flavor requested by the url still wins
    select: (id: string | undefined) => void;
}

const FLAVOR_CTX = React.createContext<FlavorState>({ flavor: DASHQL_FLAVOR, requested: null, select: () => { } });

type Props = {
    /// The flavor requested by the url, it wins over the flavor of the app settings
    requested: AppFlavor | null;
    /// The children
    children: React.ReactElement;
};

/// Provides the flavor of the app and brands the document with it
export const FlavorProvider: React.FC<Props> = (props: Props) => {
    const [settingId, setSettingId] = React.useState<string | undefined>(undefined);
    const flavor = selectFlavor(props.requested, settingId);
    React.useLayoutEffect(() => {
        applyFlavorToDocument(flavor);
    }, [flavor]);
    const state = React.useMemo<FlavorState>(() => ({
        flavor,
        requested: props.requested,
        select: setSettingId,
    }), [flavor, props.requested]);
    return <FLAVOR_CTX.Provider value={state}>{props.children}</FLAVOR_CTX.Provider>;
};

export const useAppFlavor = (): AppFlavor => React.useContext(FLAVOR_CTX).flavor;
export const useRequestedAppFlavor = (): AppFlavor | null => React.useContext(FLAVOR_CTX).requested;
export const useAppFlavorSelect = (): ((id: string | undefined) => void) => React.useContext(FLAVOR_CTX).select;

/// Keeps the flavor query parameter in the url when the router navigates, so that reloads keep the flavor.
/// With the hash router, the routes live in the hash and the query parameter is never dropped.
/// A flavor of the app settings is not added to the url, it would otherwise pin the flavor.
export function FlavorUrlKeeper() {
    const requested = useRequestedAppFlavor();
    const location = useLocation();
    React.useLayoutEffect(() => {
        const next = requested == null ? null : withFlavorParameter(new URL(globalThis.location.href), requested);
        if (next != null) {
            // Replace the url without the router, the history state still holds the router state
            globalThis.history.replaceState(globalThis.history.state, '', next);
        }
    }, [requested, location]);
    return null;
}

/// The logo of the app flavor, sized by either its height or its width
export function FlavorLogo(props: { height?: number; width?: number; ariaHidden?: boolean }) {
    const logo = useAppFlavor().logo;
    const height = props.height ?? (props.width ?? 0) / logo.aspectRatio;
    const width = props.width ?? height * logo.aspectRatio;
    return (
        <svg width={`${width}px`} height={`${height}px`} aria-hidden={props.ariaHidden}>
            <use xlinkHref={`${symbols}#${logo.symbol}`} />
        </svg>
    );
}
