import * as React from 'react';
import * as styles from './json_demo.module.css';
import { useLogger } from '../../platform/logger_provider.js';
import { JsonView } from '../../view/json_tree/index.js';

const LOG_CTX = "json_demo";

export function JsonViewerExperimentPage(): React.ReactElement {
    const logger = useLogger();
    const [jsonText, setJsonText] = React.useState<string>(`{
        "foo": "bar"
    }`);

    const onChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setJsonText(event.currentTarget.value);
    }, [setJsonText]);
    const jsonObj = React.useMemo<object>(() => {
        try {
            return JSON.parse(jsonText);
        } catch (e: any) {
            logger.error(e.toString(), {}, LOG_CTX);
        }
        return null;
    }, [jsonText]);

    return (
        <div className={styles.root}>
            <div className={styles.demo_section}>
                <div className={styles.demo_section_header}>
                    Json Viewer Demo
                </div>
                <div className={styles.demo_section_body}>
                    <textarea
                        onChange={onChange}
                        value={jsonText}
                    />
                    <JsonView value={jsonObj} />
                </div>
            </div>
        </div>
    );
}
