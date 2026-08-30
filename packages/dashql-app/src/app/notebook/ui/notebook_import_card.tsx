import * as React from 'react';

import * as baseStyles from '../../../ui/banner/banner_page.module.css';
import * as styles from './notebook_import_card.module.css';
import { ParticleFlowBackground } from '../../../ui/particle_flow/particle_flow_background.js';
import { CompactNavBar } from '../../ui/navbar.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../../ui/foundations/button.js';
import { XIcon } from '../../../ui/foundations/symbol_icon.js';

interface Props {
    title: string;
    children: React.ReactNode;
    actions?: React.ReactNode;
    busy?: boolean;
    closeDisabled?: boolean;
    onClose?: () => void;
}

export function NotebookImportCard(props: Props): React.ReactElement {
    return (
        <div className={`${baseStyles.page} ${styles.page}`} data-electron-drag-region>
            <ParticleFlowBackground />
            <CompactNavBar />
            <main className={`${baseStyles.banner_and_content_container} ${styles.foreground}`}>
                <div className={baseStyles.content_container}>
                    <section
                        className={`${baseStyles.card} ${styles.card}`}
                        aria-labelledby="notebook-import-card-title"
                        aria-busy={props.busy || undefined}
                    >
                        <div className={baseStyles.card_header} data-electron-drag-region>
                            <div className={baseStyles.card_header_left_container}>
                                <h1 id="notebook-import-card-title" className={`${baseStyles.card_header_left_title} ${styles.title}`}>
                                    {props.title}
                                </h1>
                            </div>
                            {props.onClose != null && (
                                <div className={baseStyles.card_header_right_container}>
                                    <IconButton
                                        aria-label="Close"
                                        disabled={props.closeDisabled}
                                        size={ButtonSize.Small}
                                        variant={ButtonVariant.Invisible}
                                        onClick={props.onClose}
                                    >
                                        <XIcon size={16} />
                                    </IconButton>
                                </div>
                            )}
                        </div>
                        <div className={baseStyles.card_section}>
                            <div className={baseStyles.section_entries}>{props.children}</div>
                            {props.actions != null && (
                                <div className={baseStyles.card_actions}>
                                    <div className={baseStyles.card_actions_right}>{props.actions}</div>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

export function NotebookImportDetails(props: React.PropsWithChildren): React.ReactElement {
    return <dl className={styles.details}>{props.children}</dl>;
}

export function NotebookImportDetail(props: { label: string; children: React.ReactNode; mono?: boolean }): React.ReactElement {
    return (
        <>
            <dt>{props.label}</dt>
            <dd className={props.mono ? styles.mono : undefined}>{props.children}</dd>
        </>
    );
}
