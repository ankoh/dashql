import * as React from 'react';
import * as styles from './hyper_plan_demo.module.css';
import { useDashQLCoreSetup } from '../../core_provider.js';

export function HyperPlanDemoPage(): React.ReactElement {
    const coreSetup = useDashQLCoreSetup();


    const onChange = React.useCallback(async (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const _core = await coreSetup("app_settings");
        console.log(event);
    }, []);

    return (
        <div className={styles.root}>
            <div className={styles.demo_section}>
                <div className={styles.demo_section_header}>
                    Hyper Plan Demo
                </div>
                <div className={styles.demo_section_body}>
                    <textarea
                        onChange={onChange}
                    />
                </div>
            </div>
        </div>
    );
}
