import * as React from 'react';

import { useEmbeddedDatabaseSetup } from '../../../platform/database/embedded_database_provider.js';
import type { ConnectionState } from '../connection_state.js';
import { EmbeddedHyperDatabaseChannel } from '../embedded/embedded_database_channel.js';
import { getHyperConnectionDetails } from '../hyper/hyper_connection_state.js';
import { timestampToDate } from '../proto_helper.js';
import { CONNECTION_HEALTH_COLORS, CONNECTION_HEALTH_NAMES } from './connection_status.js';
import { formatClock } from './connection_metrics.js';
import * as styles from './connection_overview_page.module.css';

/// The time since a date, e.g. 42s, 12m, 3h 05m
function formatSince(date: Date, now: number): string {
    const seconds = Math.max(Math.floor((now - date.getTime()) / 1000), 0);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, '0')}m`;
}

/// The version of the embedded Hyper, null until it is read
function useEmbeddedHyperVersion(): string | null {
    const setupDatabase = useEmbeddedDatabaseSetup();
    const [version, setVersion] = React.useState<string | null>(null);
    React.useEffect(() => {
        let cancelled = false;
        setupDatabase('connection_overview')
            .then(database => database.getVersion())
            .then(v => { if (!cancelled) setVersion(v); })
            .catch(() => { if (!cancelled) setVersion(null); });
        return () => { cancelled = true; };
    }, [setupDatabase]);
    return version;
}

/// The sizes of the catalog of a connection
function catalogSizes(connection: ConnectionState): { schemas: number; tables: number } {
    // The catalog caches its snapshot until it is modified
    const reader = connection.catalog.createSnapshot().read().catalogReader;
    return { schemas: reader.schemasLength(), tables: reader.tablesLength() };
}

const Detail: React.FC<{ label: string; title?: string; testId: string; children: React.ReactNode }> = props => (
    <>
        <dt className={styles.detail_label}>{props.label}</dt>
        <dd className={styles.detail_value} title={props.title} data-testid={props.testId}>{props.children}</dd>
    </>
);

interface Props {
    /// The connection
    connection: ConnectionState;
}

/// The current time, advanced every 10 seconds for the time since the connection was set up
function useClock(): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 10_000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

/// The facts about an embedded Hyper connection: its health, engine, session and catalog
export const ConnectionOverviewDetails: React.FC<Props> = ({ connection }) => {
    const now = useClock();
    const version = useEmbeddedHyperVersion();
    const details = getHyperConnectionDetails(connection);
    const connectedAt = timestampToDate(details?.proto.setupTimings?.channelReadyAt);
    const channel = details?.channel;
    const sessionId = channel instanceof EmbeddedHyperDatabaseChannel ? channel.sessionId : null;
    const catalog = catalogSizes(connection);
    const health = connection.connectionHealth ?? 0;
    return (
        <section className={styles.details} aria-label="Details" data-testid="connection-details">
            <header className={styles.details_header}>
                <h3 className={styles.details_title}>Details</h3>
            </header>
            <dl className={styles.details_list}>
                <Detail label="Status" testId="detail-status">
                    <span className={styles.status_dot} style={{ backgroundColor: CONNECTION_HEALTH_COLORS[health] }} />
                    {CONNECTION_HEALTH_NAMES[health]}
                </Detail>
                <Detail label="Engine" testId="detail-engine">Hyper, embedded (WebAssembly)</Detail>
                <Detail label="Version" title={version ?? undefined} testId="detail-version">{version ?? '–'}</Detail>
                <Detail label="Connected" testId="detail-connected">
                    {connectedAt == null ? '–' : `${formatClock(connectedAt.getTime())} (${formatSince(connectedAt, now)})`}
                </Detail>
                <Detail label="Session" title={sessionId ?? undefined} testId="detail-session">
                    <span className={styles.detail_mono}>{sessionId ?? '–'}</span>
                </Detail>
                <Detail label="Catalog" testId="detail-catalog">
                    {`${catalog.schemas} schemas · ${catalog.tables} tables`}
                </Detail>
            </dl>
        </section>
    );
};
