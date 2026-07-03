import * as React from 'react';
import * as detailStyles from './notebook_script_details.module.css';

import { ConnectionState } from '../../connection/connection_state.js';
import { CatalogScriptCard } from './catalog_script_card.js';

export interface CatalogSchemaViewProps {
    connection: ConnectionState;
}

export const CatalogSchemaView: React.FC<CatalogSchemaViewProps> = (props) => {
    const lastFullRefresh = props.connection.catalogUpdates.lastFullRefresh;

    return (
        <div className={detailStyles.entry_body_container}>
            <CatalogScriptCard
                script={props.connection.catalogRelationScript}
                fileName="dashql-relations.sql"
                lastFullRefresh={lastFullRefresh}
            />
        </div>
    );
};
