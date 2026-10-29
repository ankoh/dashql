import * as dashql from '@ankoh/dashql-core';
import * as React from 'react';

import * as baseStyles from '../../ui/banner/banner_page.module.css';
import * as styles from './core_panic_overlay.module.css';

import { Button, ButtonVariant } from '../../ui/foundations/button.js';
import { useAppRestart } from '../../platform/crosstab/app_hand_over.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

const LOG_CTX = 'core';

/// Block the app after a panic of the core and ask for a reload.
/// The core stays unusable after a panic, the restart flushes the storage writers before it reloads.
export function CorePanicOverlay(props: { subscribe?: typeof dashql.onCorePanic }) {
    const logger = useLogger();
    const restart = useAppRestart();
    const subscribe = props.subscribe ?? dashql.onCorePanic;
    const [message, setMessage] = React.useState<string | null>(null);
    React.useEffect(() => subscribe(panic => {
        logger.error("Core panicked", { message: panic }, LOG_CTX);
        setMessage(current => current ?? panic);
    }), [logger, subscribe]);

    if (message == null) return null;
    return (
        <div className={styles.overlay} data-testid="core-panic">
            <div className={`${baseStyles.card} ${styles.card}`}>
                <div className={baseStyles.card_header}>
                    <div className={baseStyles.card_header_left_container}>
                        <div className={baseStyles.card_header_left_title}>
                            Reload Required
                        </div>
                    </div>
                </div>
                <div className={baseStyles.card_section}>
                    <div className={`${baseStyles.section_entries} ${styles.description}`}>
                        DashQL hit an internal error and cannot continue. Your saved changes are kept, reload to continue.
                        <div className={styles.message}>{message}</div>
                    </div>
                    <div className={baseStyles.card_actions}>
                        <div className={baseStyles.card_actions_right}>
                            <Button
                                variant={ButtonVariant.Primary}
                                data-testid="core-panic-reload"
                                onClick={() => void restart()}
                            >
                                Reload
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
