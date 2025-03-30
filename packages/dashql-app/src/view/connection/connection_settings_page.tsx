import * as React from 'react';

import { CONNECTOR_INFOS, ConnectorType } from '../../connection/connector_info.js';
import { useCurrentWorkbookState } from '../../workbook/current_workbook.js';
import { useConnectionRegistry } from '../../connection/connection_registry.js';

import * as styles from './connection_settings_page.module.css';
import * as icons from '../../../static/svg/symbols.generated.svg';

// type PageState = {
//     workbook: null | {
//         connectionId: number;
//         connectorType: ConnectorType
//     };
//     focus: ConnectorType;
// };
// type PageStateSetter = Dispatch<React.SetStateAction<PageState>>;
// const PAGE_STATE_CTX = React.createContext<[PageState, PageStateSetter] | null>(null);

// interface ConnectorProps extends VerticalTabProps {
//     connectorType: ConnectorType;
// }


// const CONNECTOR_TABS: ConnectorType[] = [
//     ConnectorType.HYPER_GRPC,
//     ConnectorType.SALESFORCE_DATA_CLOUD,
//     ConnectorType.TRINO
// ];
// 
// const CONNECTOR_RENDERERS: VerticalTabRenderers<ConnectorProps> = {
//     [ConnectorType.HYPER_GRPC as number]: (props: ConnectorProps) => <PlatformCheck connectorType={props.connectorType}><HyperGrpcConnectorSettings /></PlatformCheck>,
//     [ConnectorType.SALESFORCE_DATA_CLOUD as number]: (props: ConnectorProps) => <PlatformCheck connectorType={props.connectorType}><SalesforceConnectorSettings /></PlatformCheck>,
//     [ConnectorType.TRINO as number]: (props: ConnectorProps) => <PlatformCheck connectorType={props.connectorType}><TrinoConnectorSettings /></PlatformCheck>,
// };

interface ConnectionGroupProps {
    connector: ConnectorType;
    selected: number | null;
}

function ConnectionGroup(props: ConnectionGroupProps): React.ReactElement {
    const info = CONNECTOR_INFOS[props.connector as number];
    return (
        <div
            key={props.connector as number}
            className={styles.connector}
            data-tab={props.connector as number}
            onClick={console.log}
        >
            <button className={styles.connector_button}>
                <svg className={styles.connector_icon} width="18px" height="16px">
                    <use xlinkHref={`${icons}#${info.icons.outlines}`} />
                </svg>
                <div className={styles.connector_label}>{info.displayName.short}</div>
            </button>
        </div>
    );
}

interface PageProps { }

export const ConnectionSettingsPage: React.FC<PageProps> = (_props: PageProps) => {
    const connRegistry = useConnectionRegistry();
    const [currentWorkbook, _] = useCurrentWorkbookState();
    const [focusedConnection, setFocusedConnection] = React.useState<number | null>(null);

    React.useEffect(() => {
        if (currentWorkbook != null) {
            setFocusedConnection(currentWorkbook.connectionId);
        } else {

        }
    }, []);

    // // If someone selects a Trino workbook, we should switch to the appropriate connector settings automatically.
    // // Note that this suffers a bit right now from the fact that we only have one connection per connector.
    // // Otherwise we could just always switch to the correct connection id.
    // React.useEffect(() => {
    //     if (currentWorkbook != null && pageState.workbook?.connectionId != (currentWorkbook?.connectionId ?? null)) {
    //         const newFocus = currentWorkbook.connectorInfo.connectorType;
    //         if (newFocus != ConnectorType.SERVERLESS && newFocus != ConnectorType.DEMO) {
    //             updatePageState({
    //                 workbook: {
    //                     connectionId: currentWorkbook.connectionId,
    //                     connectorType: currentWorkbook.connectorInfo.connectorType,
    //                 },
    //                 focus: newFocus,
    //             });
    //         }
    //     }
    // }, [currentWorkbook]);

    // const connectors: Record<number, ConnectorProps> = React.useMemo(() => {
    //     let connectorProps: Record<number, ConnectorProps> = {};
    //     for (const tabType of CONNECTOR_TABS) {
    //         const connInfo = CONNECTOR_INFOS[tabType as number];
    //         connectorProps[tabType] = {
    //             tabId: tabType as number,
    //             labelShort: connInfo.displayName.short,
    //             labelLong: connInfo.displayName.long,
    //             icon: `${icons}#${connInfo.icons.outlines}`,
    //             iconActive: `${icons}#${connInfo.icons.uncolored}`,
    //             connectorType: tabType
    //         };
    //     }
    //     return connectorProps;
    // }, []);

    //                variant={VerticalTabVariant.Wide}
    //                selectedTab={pageState.focus}
    //                selectTab={selectConnector}
    //                tabKeys={CONNECTOR_TABS}
    //                tabProps={connectors}
    //                tabRenderers={CONNECTOR_RENDERERS}
    //                />
    return (
        <div className={styles.container}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.header_title}>Connection</div>
                </div>
            </div>
            <div className={styles.body_container}>
                <div className={styles.connection_list}>
                    <div className={styles.connector_group}>
                        {[ConnectorType.SALESFORCE_DATA_CLOUD, ConnectorType.HYPER_GRPC, ConnectorType.TRINO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={focusedConnection} />)}
                    </div>
                    <div className={styles.connector_group}>
                        {[ConnectorType.SERVERLESS, ConnectorType.DEMO]
                            .map(t => <ConnectionGroup key={t as number} connector={t} selected={focusedConnection} />)}
                    </div>
                </div>
                <div className={styles.connection_settings_container}>

                </div>
            </div>
        </div >
    );
};
