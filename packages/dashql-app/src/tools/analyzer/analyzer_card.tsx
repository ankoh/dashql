import * as React from 'react';

import { ChevronDownIcon, ChevronRightIcon } from '@akohn/dashql-react/components/symbol_icon';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import * as styles from './analyzer_card.module.css';

export interface AnalyzerCardProps {
    /// The title in the header
    title: string;
    /// The icon in front of the title
    icon: React.ElementType<{ size?: number; className?: string }>;
    /// A short summary next to the title, e.g. the statements of the script
    summary: string;
    expanded: boolean;
    onToggle: () => void;
    /// The editor of the script, rendered while the card is expanded
    editor: () => React.ReactNode;
    /// What the phases know about the script, below the editor, if the card shows them
    phases?: () => React.ReactNode;
    /// The actions on the script, at the right of the header while the card is expanded
    actions?: () => React.ReactNode;
}

/// A script of the analyzer tool: its editor, and below it what the scanner, the parser and the analyzer know about it,
/// if the card shows that
export function AnalyzerCard({ title, icon: Icon, summary, expanded, onToggle, editor, phases, actions }: AnalyzerCardProps) {
    const bodyId = React.useId();
    return (
        <section className={classNames(styles.card, expanded && styles.card_expanded)} aria-label={title}>
            <div className={styles.header}>
                <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    onClick={onToggle}
                >
                    {expanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                    <Icon size={16} className={styles.icon} />
                    <span className={styles.title}>{title}</span>
                    <span className={styles.summary}>{summary}</span>
                </button>
                {expanded && actions != null && <div className={styles.actions}>{actions()}</div>}
            </div>
            {expanded && (
                <div id={bodyId} className={styles.body}>
                    <div className={styles.editor}>{editor()}</div>
                    {phases?.()}
                </div>
            )}
        </section>
    );
}
