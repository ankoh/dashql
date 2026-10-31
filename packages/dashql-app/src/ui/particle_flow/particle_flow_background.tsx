import * as React from 'react';
import { attachParticleFlow } from '@ankoh/dashql-ui/particle_flow';

import * as styles from './particle_flow_background.module.css';

export const ParticleFlowBackground: React.FC = () => {
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const container = containerRef.current;
        if (container == null) {
            return;
        }
        return attachParticleFlow(container);
    }, []);

    return <div ref={containerRef} className={styles.background} aria-hidden="true" />;
};
