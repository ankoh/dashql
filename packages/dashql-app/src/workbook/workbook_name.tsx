import * as React from 'react';

import { useView } from '../runtime/runtime_hooks.js';

/// The name of a workbook, its id if it has none
export function WorkbookName(props: { workbookId: string }): React.ReactElement {
    const workbook = useView('workbook', props.workbookId);
    return <>{workbook?.name?.trim() || props.workbookId}</>;
}

/// Render the name of a workbook
export const renderWorkbookName = (workbookId: string) => <WorkbookName workbookId={workbookId} />;
