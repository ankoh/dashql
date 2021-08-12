import React from 'react';
import { TerminalEmulator } from './terminal_emulator';
import { useDatabaseClient } from '../database_client';

import styles from './terminal.module.css';

type Props = Record<string, string>;

export const Terminal: React.FC<Props> = (props: Props) => {
    const termRef = React.useRef<TerminalEmulator>(new TerminalEmulator());
    const termContainer = React.createRef<HTMLDivElement>();
    const database = useDatabaseClient();

    // Evaluate the terminal input
    const evalTermInput = async (text: string) => {
        const result = await database.use(async conn => {
            return await conn.runQuery(text);
        });
        const term = termRef.current;
        for (const row of result) {
            term.printLine(row.toString());
        }
    };

    // Run the terminal eval loop
    const runTermEvalLoop = React.useCallback(
        async (text: string | null = null) => {
            if (text != null) {
                await evalTermInput(text);
            }

            // Schedule next read
            termRef.current
                .read('> ', '   ')
                .then(runTermEvalLoop)
                .catch((txt: string) => {
                    termRef.current.printLine('error: ' + txt);
                });
        },
        [termRef.current],
    );

    React.useEffect(() => {
        if (!termContainer.current) return () => {};
        // Prepare the terminal
        const term = termRef.current;
        term.open(termContainer.current);
        term.fit();
        term.attach();
        term.focus();

        // Start the eval loop
        runTermEvalLoop();

        return () => termRef.current.detach();
    }, [termContainer.current]);

    return (
        <div className={styles.root}>
            <div ref={termContainer} className={styles.term_container}></div>
        </div>
    );
};

export default Terminal;
