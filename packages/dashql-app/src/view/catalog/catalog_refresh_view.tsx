import * as React from "react";
import * as styles from "./catalog_refresh_view.module.css";

import { motion } from 'framer-motion';

import { ConnectionState } from "../../connection/connection_state.js";
import { CATALOG_UPDATE_TASK_STATUS_NAMES, CatalogUpdateTaskState } from "../../connection/catalog_update_state.js";
import { QueryInfoListView } from "../query_status/query_info_list_view.js";

interface CatalogRefreshViewProps {
    conn: ConnectionState;
    refresh: CatalogUpdateTaskState;
}

export function CatalogRefreshView(props: CatalogRefreshViewProps) {
    return (
        <div className={styles.root}>
            <motion.div
                className={styles.root_background}
                layoutId="catalog_info_background"
                layout="size"
                transition={{ duration: 0.2, ease: [0.33, 1, 0.68, 1] }}
            />
            <div className={styles.header}>
                {CATALOG_UPDATE_TASK_STATUS_NAMES[props.refresh.status]}
            </div>
            <div className={styles.query_list}>
                <QueryInfoListView conn={props.conn.connectionId} connQueries={props.refresh?.queries ?? []} />
            </div>
        </div>
    );
}
