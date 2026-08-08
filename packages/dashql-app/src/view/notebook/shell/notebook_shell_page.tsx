import * as React from 'react';
import * as styles from './notebook_shell_page.module.css';

import type { ConnectionState } from '../../../connection/connection_state.js';
import { NotebookViewMode, useNotebookViewMode } from '../../../scripts/notebook_commands.js';
import type { NotebookScripts } from '../../../scripts/notebook_scripts.js';
import { KeyEventHandler, useKeyEvents } from '../../../utils/key_events.js';
import { CatalogFunctionsView } from '../catalog_functions_view.js';
import { CatalogSchemaView } from '../catalog_schema_view.js';
import { NotebookShell } from './notebook_shell.js';

type CatalogTab = 'relations' | 'functions';

interface Props {
    notebookScripts: NotebookScripts;
    connection: ConnectionState | null;
    active: boolean;
    openConnectionOverlay: () => void;
}

export const NotebookShellPage: React.FC<Props> = (props) => {
    const { setMode: setNotebookMode } = useNotebookViewMode();
    const [catalogTab, setCatalogTab] = React.useState<CatalogTab | null>(null);
    const shellActive = props.active && catalogTab == null;
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [{
        key: 'Escape',
        ctrlKey: false,
        callback: () => {
            if (!props.active) return;
            if (catalogTab != null) {
                setCatalogTab(null);
                return;
            }
            setNotebookMode(NotebookViewMode.Notebook);
        },
    }], [catalogTab, props.active, setNotebookMode]);
    useKeyEvents(keyHandlers);

    return (
        <main className={styles.page} id="notebook-body">
            <div className={shellActive ? styles.shell_layer : styles.shell_layer_hidden}>
                <NotebookShell
                    key={props.notebookScripts.notebookId}
                    notebookScripts={props.notebookScripts}
                    connection={props.connection}
                    active={shellActive}
                    openConnectionOverlay={props.openConnectionOverlay}
                    openCatalog={setCatalogTab}
                />
            </div>
            {catalogTab === 'relations' && props.connection
                ? <CatalogSchemaView connection={props.connection} onClose={() => setCatalogTab(null)} />
                : catalogTab === 'functions' && props.connection
                    ? <CatalogFunctionsView connection={props.connection} onClose={() => setCatalogTab(null)} />
                    : null}
        </main>
    );
};
