import * as React from 'react';
import * as styles from './catalog_panel.module.css';

import { CatalogViewer } from '../catalog/catalog_viewer.js';
import { useRouteContext } from '../../router.js';
import { useWorkbookState } from '../../workbook/workbook_state_registry.js';

interface CatalogPanelProps { }

export function CatalogPanel(_props: CatalogPanelProps) {
    const route = useRouteContext();
    const [workbook, _dispatchWorkbook] = useWorkbookState(route.workbookId ?? null);

    if (workbook == null) {
        return <div />;
    }
    return (
        <div className={styles.root}>
            <div className={styles.panel_container}>
                <div className={styles.catalog_viewer}>
                    <CatalogViewer workbookId={workbook.workbookId} />
                </div>
            </div>
        </div>
    );
}
