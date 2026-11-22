import * as React from 'react';

import { classNames } from '@akohn/dashql-react/dom/classnames';

import * as styles from './stage_section.module.css';

interface Props {
    /// The name of the section, written above its content, e.g. "Parameters"
    label: string;
    className?: string;
    testId?: string;
    children: React.ReactNode;
}

/// The label of a section, alone where the content is not a child, e.g. the scripts of the feed below its head
export function StageLabel(props: { label: string; id?: string; className?: string }): React.ReactElement {
    return <h2 id={props.id} className={classNames(styles.label, props.className)}>{props.label}</h2>;
}

/// A section of the feed or the dashboard, its label stands on the stage above the content
export function StageSection(props: Props): React.ReactElement {
    const labelId = React.useId();
    return (
        <section className={classNames(styles.section, props.className)} aria-labelledby={labelId} data-testid={props.testId}>
            <StageLabel id={labelId} label={props.label} />
            {props.children}
        </section>
    );
}
