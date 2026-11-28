import * as React from 'react';
import * as styles from './dataflow_view.module.css';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { ModifyWorkbookScripts, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { DataflowCanvas, type DataflowRevealRequest } from './dataflow_canvas.js';
import { ScriptEditorDialog } from '../scripts/script_editor_dialog.js';
import { useScriptSelection } from '../scripts/script_selection.js';

type CanvasProps = React.ComponentProps<typeof DataflowCanvas>;
type EditorDialogProps = React.ComponentProps<typeof ScriptEditorDialog>;

const renderCanvas = (props: CanvasProps) => <DataflowCanvas {...props} />;
const renderEditorDialog = (props: EditorDialogProps) => <ScriptEditorDialog {...props} />;

export interface DataflowViewProps {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connections that the scripts run on
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    /// A script to show, e.g. one that the prompt created
    revealRequest?: DataflowRevealRequest | null;
    /// The height that the prompt covers at the bottom of the canvas
    bottomInset?: () => number;
    // The heavy parts are slots with the real ones as defaults. A test shows stand-ins: they need the layout of the
    // dataflow or editors.
    /// The canvas of the dataflow
    canvas?: (props: CanvasProps) => React.ReactNode;
    /// The editor dialog of a script of the canvas
    editorDialog?: (props: EditorDialogProps) => React.ReactNode;
}

/// The dataflow of a workbook: the canvas and the editor dialog of the script that a box opens. The dialog belongs to
/// the view, it closes with it, when another workbook shows (the view starts over for every workbook) or when its
/// script is gone.
export function DataflowView(props: DataflowViewProps): React.ReactElement {
    return <WorkbookDataflowView key={props.workbookScripts.workbookId} {...props} />;
}

function WorkbookDataflowView(props: DataflowViewProps): React.ReactElement {
    const { workbookScripts, modifyWorkbookScripts, scriptConnections, canvas = renderCanvas, editorDialog = renderEditorDialog } = props;
    // The script that the editor dialog shows
    const [inspected, setInspected] = React.useState<number | null>(null);
    const shown = inspected != null && workbookScripts.scriptKeys.includes(inspected) ? inspected : null;
    // The dialog selects its script, the commands of the workbook (Ctrl+E) run the selected script
    const selection = useScriptSelection();
    const inspect = React.useCallback((scriptKey: number) => {
        const fileName = workbookScripts.scriptOrder[workbookScripts.scriptKeys.indexOf(scriptKey)];
        if (fileName == null) return;
        selection.selectFile(workbookScripts, fileName);
        setInspected(scriptKey);
    }, [workbookScripts, selection]);
    const close = React.useCallback(() => setInspected(null), []);
    return (
        <div className={styles.layout}>
            <div className={styles.canvas}>
                {canvas({
                    workbookScripts,
                    modifyWorkbookScripts,
                    scriptConnections,
                    onInspect: inspect,
                    revealRequest: props.revealRequest,
                    bottomInset: props.bottomInset,
                })}
            </div>
            {shown != null && (
                <React.Fragment key={shown}>
                    {editorDialog({
                        workbookScripts,
                        modifyWorkbookScripts,
                        scriptKey: shown,
                        scriptConnections,
                        onNavigateToScript: inspect,
                        onClose: close,
                    })}
                </React.Fragment>
            )}
        </div>
    );
}
