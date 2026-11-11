import * as React from 'react';

import { useCloudConnection } from '../../connections/cloud_connection.js';
import { CloudSetupPage, type CloudSetupPageDependencies } from '../../cloud/cloud_setup_page.js';
import { useCloudState } from '../../cloud/cloud_state.js';

/// Why the page of the cloud setup shows
type CloudSetupReason = 'startup' | 'requested';

/// Show the page of the cloud setup before the workbench: once at the start of the app when there is a cloud
/// connection, and whenever the Cloud overlay asks for it. Returns the page, null when it doesn't show.
export function useCloudSetupGate(setupDone: Promise<void>, dependencies?: CloudSetupPageDependencies): React.ReactElement | null {
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        let live = true;
        setupDone.then(() => { if (live) setReady(true); }, () => {});
        return () => { live = false; };
    }, [setupDone]);

    const cloud = useCloudConnection();
    const { setupRequests } = useCloudState();
    const [reason, setReason] = React.useState<CloudSetupReason | null>(null);

    // The start of the app shows the page once, if there is a cloud connection after the setup
    const startupConsidered = React.useRef(false);
    React.useEffect(() => {
        if (!ready || startupConsidered.current) return;
        startupConsidered.current = true;
        if (cloud != null) setReason('startup');
    }, [ready, cloud]);

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
