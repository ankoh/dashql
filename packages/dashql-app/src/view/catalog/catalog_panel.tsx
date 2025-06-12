import * as React from 'react';
import * as styles from './catalog_panel.module.css';

import { CatalogViewer } from '../catalog/catalog_viewer.js';
import { classNames } from '../../utils/classnames.js';
import { useRouteContext } from '../../router.js';
import { useWorkbookState } from '../../workbook/workbook_state_registry.js';

interface CatalogPanelProps {
    className?: string;
}

export function CatalogPanel(props: CatalogPanelProps) {
    const route = useRouteContext();
    const [workbook, _dispatchWorkbook] = useWorkbookState(route.workbookId ?? null);

    if (workbook == null) {
        return <div />;
    }
    return (
        <div className={classNames(styles.root, props.className)}>
            <div className={styles.catalog_viewer}>
                <CatalogViewer workbookId={workbook.workbookId} />
            </div>
        </div>
    );
}
