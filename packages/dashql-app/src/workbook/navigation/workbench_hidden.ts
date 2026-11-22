import * as React from 'react';

import { useAppConfig, useAppReconfigure } from '../../config/app_config.js';

/// Is the workbench of the workbook page hidden? Saved with the settings of the app, like the width of the nav rail.
export function useWorkbenchHidden(): [boolean, (hidden: boolean) => void] {
    const config = useAppConfig();
    const reconfigure = useAppReconfigure();
    const hidden = config?.settings?.workbenchHidden ?? false;
    const setHidden = React.useCallback((next: boolean) => {
        reconfigure(value => value == null || (value.settings?.workbenchHidden ?? false) === next ? value : {
            ...value,
            settings: { ...value.settings, workbenchHidden: next },
        });
    }, [reconfigure]);
    return [hidden, setHidden];
}
