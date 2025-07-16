import * as React from 'react';

import { ColumnIdentifierTemplateSnippet } from '../catalog/catalog_view_model.js';

import * as styles from './script_template.module.css';

interface Props {
    className?: string;
    snippet: ColumnIdentifierTemplateSnippet;
}

export function ColumnIdentifierTemplateSpan(props: Props): React.ReactElement {
    return (
        <span className={props.className}>
            <span className={styles.template_text_before}>
                {props.snippet.textBefore}
            </span>
            <span className={styles.template_text_placeholder} />
            <span className={styles.template_text_after}>
                {props.snippet.textAfter}
            </span>
        </span>
    );
}
