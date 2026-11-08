import * as React from 'react';
import { attachLandingBackdrop, type LandingBackdrop as Backdrop, type LandingBackdropOptions } from '@ankoh/dashql-ui/landing_backdrop';

import * as styles from './landing_backdrop_page.module.css';

/// The backdrop in a React tree on the near-black page of the demo
export function LandingBackdrop(props: LandingBackdropOptions): React.ReactElement {
    const { brand, motion, dots, particles } = props;
    const hostRef = React.useRef<HTMLDivElement>(null);
    const backdropRef = React.useRef<Backdrop | null>(null);
    const latest = React.useRef(props);
    latest.current = props;

    React.useEffect(() => {
        if (hostRef.current == null) return;
        const backdrop = attachLandingBackdrop(hostRef.current, latest.current);
        backdropRef.current = backdrop;
        return () => {
            backdropRef.current = null;
            backdrop.dispose();
        };
    }, [brand, motion, dots, particles]);

    React.useEffect(() => { backdropRef.current?.update(props); });

    return <div ref={hostRef} className={styles.host} style={{ background: 'rgb(8, 9, 11)' }} aria-hidden="true" />;
}
