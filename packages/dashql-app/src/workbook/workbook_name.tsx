import * as React from 'react';

import { useWorkbookScriptsRegistry } from './scripts/workbook_scripts_registry.js';

/// The name of a workbook, its id if it has none
export function WorkbookName(props: { workbookId: string }): React.ReactElement {
    const [scriptsRegistry] = useWorkbookScriptsRegistry();
    return <>{scriptsRegistry.workbookScriptsMap.get(props.workbookId)?.name?.trim() || props.workbookId}</>;
}

/// Render the name of a workbook
export const renderWorkbookName = (workbookId: string) => <WorkbookName workbookId={workbookId} />;
