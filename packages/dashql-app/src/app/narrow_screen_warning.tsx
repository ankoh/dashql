import * as React from 'react';

import * as baseStyles from '../ui/foundations/banner_page.module.css';
import * as styles from './narrow_screen_warning.module.css';

import { Button, ButtonVariant } from '../ui/foundations/button.js';
import { CompactNavBar } from './navbar.js';

const NARROW_SCREEN_QUERY = '(max-width: 799px)';

export function useNarrowScreenWarning(settingsReady: boolean, narrowScreenLayout: boolean): boolean {
    const [narrow, setNarrow] = React.useState(() => window.matchMedia(NARROW_SCREEN_QUERY).matches);
    React.useEffect(() => {
        const media = window.matchMedia(NARROW_SCREEN_QUERY);
        const update = () => setNarrow(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
    }, []);
    return settingsReady && narrow && !narrowScreenLayout;
}

export function NarrowScreenWarning(props: { onEnable: () => void }) {
    return (
        <div className={baseStyles.page} data-electron-drag-region>
            <CompactNavBar />
            <main className={`${baseStyles.banner_and_content_container} ${styles.foreground}`}>
                <section className={`${baseStyles.card} ${styles.card}`} aria-labelledby="narrow-screen-title">
                    <div className={baseStyles.card_header}>
                        <div className={baseStyles.card_header_left_container}>
                            <h1 id="narrow-screen-title" className={`${baseStyles.card_header_left_title} ${styles.title}`}>
                                Narrow Screen
                            </h1>
                        </div>
                    </div>
                    <div className={baseStyles.card_section}>
                        <div className={`${baseStyles.section_entries} ${styles.description}`}>
                            <p>Narrow screen sizes are not fully supported yet. For the best experience, use a wider window or a desktop browser.</p>
                            <p>You can enable the experimental narrow screen layout to continue anyway. This hides the warning and can be turned off in the internal app settings.</p>
                            <Button variant={ButtonVariant.Primary} onClick={props.onEnable}>
                                Enable Narrow Screen Layout
                            </Button>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    );
}
