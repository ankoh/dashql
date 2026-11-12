import * as React from 'react';

import { CloudSetupPage, type CloudSetupPageDependencies } from '../../cloud/cloud_setup_page.js';
import { useCloudState } from '../../cloud/cloud_state.js';

/// The parameter of a link that points to the cloud, e.g. `https://dashql.app/?cloud`
export const CLOUD_QUERY_PARAMETER = 'cloud';

/// Does a query string point to the cloud?
export function isCloudLink(search: string): boolean {
    return new URLSearchParams(search).has(CLOUD_QUERY_PARAMETER);
}

/// Why the page of the cloud setup shows
type CloudSetupReason = 'startup' | 'requested';

/// Show the page of the cloud setup before the workbench: once at the start of the app when a link points to the cloud,
/// and whenever the Cloud overlay asks for it. Any other start goes to the workbench, the cloud is then set up through
/// the Cloud overlay. Returns the page, null when it doesn't show.
export function useCloudSetupGate(setupDone: Promise<void>, cloudLink: boolean, dependencies?: CloudSetupPageDependencies): React.ReactElement | null {
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        let live = true;
        setupDone.then(() => { if (live) setReady(true); }, () => {});
        return () => { live = false; };
    }, [setupDone]);

    const { setupRequests } = useCloudState();
    const [reason, setReason] = React.useState<CloudSetupReason | null>(null);

    // The start of the app shows the page once after the setup, if a link points to the cloud
    const startupConsidered = React.useRef(false);
    React.useEffect(() => {
        if (!ready || startupConsidered.current) return;
        startupConsidered.current = true;
        if (cloudLink) setReason('startup');
    }, [ready, cloudLink]);

    // The Cloud overlay asks for the page
    const seenRequests = React.useRef(setupRequests);
    React.useEffect(() => {
        if (setupRequests === seenRequests.current) return;
        seenRequests.current = setupRequests;
        setReason('requested');
    }, [setupRequests]);

    const close = React.useCallback(() => setReason(null), []);
    return reason == null ? null : <CloudSetupPage startup={reason === 'startup'} onDone={close} dependencies={dependencies} />;
}
