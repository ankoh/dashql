import * as React from 'react';
import * as styles from './ui_internals_page.module.css';

import { TextInput } from '../foundations/text_input.js';
import { Identicon } from '../../view/foundations/identicon.js';

export function IdentInternalsPage(): React.ReactElement {
    const [seed, setSeed] = React.useState<string>();

    return (
        <div className={styles.root}>
            <div className={styles.component_section}>
                <div className={styles.component_section_header}>
                    Identicons
                </div>
                <div className={styles.component}>
                    <div className={styles.component_title}>
                        IdentIcons
                    </div>
                    <div className={styles.component_variants}>
                        <TextInput onChange={ev => setSeed((ev.target as any).value)} />
                        <Identicon
                            width={32}
                            height={32}
                            values={[seed ?? ""]}
                            style={{
                                background: "hsl(210deg, 12%, 96%)",
                                borderRadius: "8px",
                                border: "1px solid var(--border_color_primary)",
                                overflow: "hidden",
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
