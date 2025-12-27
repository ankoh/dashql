import * as React from 'react';
import * as styles from './json_demo.module.css';
import { useLogger } from '../../platform/logger_provider.js';
import { JsonView } from '../../view/json/json_view.js';

const LOG_CTX = "json_demo";

export function JsonViewerExperimentPage(): React.ReactElement {
    const logger = useLogger();
    const [jsonText, setJsonText] = React.useState<string>(`{
        "foo": "bar",
        "nested": {
            "attr": 42,
            "array": [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
            ]
        }
    }`);

    const onChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        setJsonText(event.currentTarget.value);
    }, [setJsonText]);
    const jsonObj = React.useMemo<object>(() => {
        try {
            return JSON.parse(jsonText);
        } catch (e: any) {
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
                    <JsonView
                        objectSortKeys={true}
                        value={jsonObj}
                    />
                </div>
            </div>
        </div>
    );
}
