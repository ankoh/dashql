import * as React from 'react';
import { XIcon } from '@primer/octicons-react';

import * as symbols from '../../static/svg/symbols.generated.svg';
import * as baseStyles from './banner_page.module.css';

import { AnchorAlignment, AnchorSide } from './foundations/anchored_position.js';
import { ButtonVariant, IconButton } from './foundations/button.js';
import { DASHQL_VERSION } from '../globals.js';
import { InternalsViewerOverlay } from './internals/internals_overlay.js';
import { useLogger } from '../platform/logger_provider.js';
import { SKIP_SETUP, useRouteContext, useRouterNavigate } from '../router.js';

const LOG_CTX = "app_loading";

interface Props {
}

export const AppLoadingPage: React.FC<Props> = (props: Props) => {
    const now = new Date();
    const navigate = useRouterNavigate();
    const route = useRouteContext();
    const logger = useLogger();

    // State to hide/show logs
    const [showLogs, setShowLogs] = React.useState<boolean>(false);
    // Compute the log button only once to prevent svg flickering
    const logButton = React.useMemo(() => {
        return (
            <IconButton
                variant={ButtonVariant.Invisible}
                aria-label="Close Overlay"
                onClick={() => setShowLogs(s => !s)}
            >
                <svg width="16px" height="16px">
                    <use xlinkHref={`${symbols}#processor`} />
                </svg>
            </IconButton>
        );
    }, []);

    return (
        <div className={baseStyles.page} data-tauri-drag-region>
            <div className={baseStyles.banner_and_content_container} data-tauri-drag-region>
                <div className={baseStyles.banner_container} data-tauri-drag-region>
                    <div className={baseStyles.banner_logo} data-tauri-drag-region>
                        <svg width="100%" height="100%">
                            <use xlinkHref={`${symbols}#dashql`} />
                        </svg>
                    </div>
                    <div className={baseStyles.banner_text_container} data-tauri-drag-region>
                        <div className={baseStyles.banner_title} data-tauri-drag-region>dashql</div>
                        <div className={baseStyles.app_version} data-tauri-drag-region>version {DASHQL_VERSION}</div>
                    </div>
                </div>
                <div className={baseStyles.content_container} data-tauri-drag-region>
                    <div className={baseStyles.card}>
                        <div className={baseStyles.card_header} data-tauri-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                Setup
                            </div>
                            <div className={baseStyles.card_header_right_container}>
                                <InternalsViewerOverlay
                                    isOpen={showLogs}
                                    onClose={() => setShowLogs(false)}
                                    renderAnchor={(p: object) => <div {...p}>{logButton}</div>}
                                    side={AnchorSide.OutsideBottom}
                                    align={AnchorAlignment.End}
                                    anchorOffset={16}
                                />
                                <IconButton
                                    variant={ButtonVariant.Invisible}
                                    aria-label="close-setup"
                                    onClick={() => {
                                        navigate({
                                            type: SKIP_SETUP,
                                            value: null
                                        });
                                    }}
                                >
                                    <XIcon />
                                </IconButton>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
