import * as React from 'react';

/// Is the shown workbook read-only? A preview of a published workbook is, until it is imported. The views hide what
/// runs or changes the workbook, the reducer and the runs refuse it as well. See docs/design/cloud.md.
export const WorkbookReadOnlyContext = React.createContext(false);

export function useWorkbookReadOnly(): boolean {
    return React.useContext(WorkbookReadOnlyContext);
}
