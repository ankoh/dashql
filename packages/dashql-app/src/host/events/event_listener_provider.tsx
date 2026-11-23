import * as React from 'react';

import { useLocation } from 'react-router-dom';

import { PlatformEventListener, EVENT_QUERY_PARAMETER, WORKBOOK_QUERY_PARAMETER, readWorkbookUrlParameter } from './event_listener.js';
import { ZIP_QUERY_PARAMETER } from '../../workbook/persistence/workbook_link.js';
import { LEGACY_WORKBOOK_QUERY_PARAMETERS } from './legacy_links.js';
import { useLogger } from '../logger_provider.js';

const LISTENER_CTX = React.createContext<PlatformEventListener | null>(null);
export const usePlatformEventListener = () => React.useContext(LISTENER_CTX)!;

type Props = {
    children: React.ReactElement;
};

export const PlatformEventListenerProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const location = useLocation();
    // HashRouter excludes the outer document query from its location. Setup links belong to the
    // document URL, so read them from window.location in both browser and packaged-app modes.
    const documentSearch = globalThis.location.search;

    // Construct the event listener, the desktop app hands it its deep links
    const listener = React.useMemo(() => new PlatformEventListener(logger, globalThis.dashqlElectron ?? null), [logger]);

    React.useEffect(() => {
        void listener.setup();
        return () => listener.dispose();
    }, [listener]);

    // Drop the parameters of a consumed event from the address of the current location
    const dropEventParameters = React.useEffectEvent((searchParams: URLSearchParams) => {
        searchParams.delete(EVENT_QUERY_PARAMETER);
        searchParams.delete(ZIP_QUERY_PARAMETER);
        searchParams.delete(WORKBOOK_QUERY_PARAMETER);
        for (const name of LEGACY_WORKBOOK_QUERY_PARAMETERS) searchParams.delete(name);
        const search = searchParams.toString();
        const nextUrl = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
        globalThis.history.replaceState(globalThis.history.state, '', nextUrl);
    });

    // Search for app events passed via the url parameter
    React.useEffect(() => {
        const searchParams = new URLSearchParams(documentSearch);
        const data = searchParams.get(EVENT_QUERY_PARAMETER);
        const zip = searchParams.get(ZIP_QUERY_PARAMETER);
        const workbookUrl = readWorkbookUrlParameter(searchParams);

        if (!data && !zip && !workbookUrl) {
            return;
        }

        let consumed = false;
        if (data) {
            const event = listener.readAppEvent(data, "event_listener");
            if (event != null) {
                listener.dispatchAppEvent(event);
                consumed = true;
            }
        } else if (zip) {
            consumed = listener.dispatchWorkbookZip(zip);
        } else if (workbookUrl) {
            listener.dispatchWorkbookUrl(workbookUrl);
            consumed = true;
        }
        if (consumed) {
            // Consume the event before an import can trigger a reload. Leaving `data` in the address
            // would dispatch the same workbook again and immediately reopen the conflict dialog.
            dropEventParameters(searchParams);
        }
    }, [documentSearch, listener]);

    return (
        <LISTENER_CTX.Provider value={listener}>
            {props.children}
        </LISTENER_CTX.Provider>
    )
};
