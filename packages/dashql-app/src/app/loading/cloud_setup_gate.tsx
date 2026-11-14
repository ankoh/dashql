import * as React from 'react';

import { CloudSetupPage, type CloudSetupPageDependencies } from '../../cloud/cloud_setup_page.js';
import { useClouds } from '../../cloud/cloud_state.js';
import { useCloudConnectionIds } from '../../connections/cloud_connection.js';

/// The parameter of a link that points to the cloud, e.g. `https://dashql.app/?cloud`
export const CLOUD_QUERY_PARAMETER = 'cloud';

/// Does a query string point to the cloud?
export function isCloudLink(search: string): boolean {
    return new URLSearchParams(search).has(CLOUD_QUERY_PARAMETER);
}

/// Why the page of the cloud setup shows
type CloudSetupReason = 'startup' | 'requested';

/// Show the page of the cloud setup before the workbench: once at the start of the app when a link points to the cloud,
/// and whenever the Clouds of the sidebar or the overview of a cloud ask for it. Any other start goes to the workbench.
/// Returns the page, null when it doesn't show.
export function useCloudSetupGate(setupDone: Promise<void>, cloudLink: boolean, dependencies?: CloudSetupPageDependencies): React.ReactElement | null {
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        let live = true;
        setupDone.then(() => { if (live) setReady(true); }, () => {});
        return () => { live = false; };
    }, [setupDone]);

    const { setupRequest } = useClouds();
    const [reason, setReason] = React.useState<CloudSetupReason | null>(null);
    // The cloud that the page sets up, null to choose or add one
    const [target, setTarget] = React.useState<string | null>(null);

    // The start of the app shows the page once after the setup, if a link points to the cloud. With a single cloud the
    // page sets up that one, otherwise it lets the user choose.
    const cloudConnectionIds = useCloudConnectionIds();
    const startupConsidered = React.useRef(false);
    React.useEffect(() => {
        if (!ready || startupConsidered.current) return;
        startupConsidered.current = true;
        if (!cloudLink) return;
        setTarget(cloudConnectionIds.length === 1 ? cloudConnectionIds[0] : null);
        setReason('startup');
    }, [ready, cloudLink, cloudConnectionIds]);

    // The app asks for the page
    const seenRequest = React.useRef(setupRequest?.id ?? 0);
    React.useEffect(() => {
        if (setupRequest == null || setupRequest.id === seenRequest.current) return;
        seenRequest.current = setupRequest.id;
        setTarget(setupRequest.connectionId);
        setReason('requested');
    }, [setupRequest]);

    const close = React.useCallback(() => setReason(null), []);
    return reason == null ? null : (
        <CloudSetupPage startup={reason === 'startup'} connectionId={target} onChoose={setTarget} onDone={close} dependencies={dependencies} />
    );
}
