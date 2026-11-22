import * as React from 'react';

import { useAppConfig, useAppReconfigure } from '../../config/app_config.js';
import { SETTLE_IMPORTED_WORKBOOK, useRouteContext, useRouterNavigate } from '../../app/router.js';

/// Is the workbench of the workbook page hidden? Saved with the settings of the app, like the width of the nav rail.
///
/// A workbook that was just imported from outside the app (a dropped file, a shared link) and opens in its dashboard or
/// dataflow shows it without the workbench, whatever the setting says. That comes from where the workbook arrived from,
/// not from the workbook, and it is not saved: showing the workbench settles the import, and another workbook ends it.
export function useWorkbenchHidden(workbookId: string, opensInView: boolean): [boolean, (hidden: boolean) => void] {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const saved = config?.settings?.workbenchHidden ?? false;
    const imported = opensInView && route.importedWorkbookId != null && route.importedWorkbookId === workbookId;
    const setHidden = React.useCallback((next: boolean) => {
        if (imported) navigate({ type: SETTLE_IMPORTED_WORKBOOK, value: null });
        reconfigure(value => value == null || (value.settings?.workbenchHidden ?? false) === next ? value : {
            ...value,
            settings: { ...value.settings, workbenchHidden: next },
        });
    }, [imported, navigate, reconfigure]);
    return [saved || imported, setHidden];
}
