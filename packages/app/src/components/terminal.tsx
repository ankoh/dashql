import React from 'react';
import { IAppContext, withAppContext } from '../app_context';
import { TerminalEmulator } from './terminal_emulator';

import styles from './terminal.module.css';

interface Props {
    /// The app context
    appContext: IAppContext;
}

class Terminal extends React.Component<Props> {
    /// The terminal emulator
    protected term: TerminalEmulator;
    /// The terminal container
    protected termContainer: React.RefObject<HTMLDivElement>;
    /// The terminal input
    protected termInput: string;

    /// Constructor
    constructor(props: Props) {
        super(props);
        this.term = new TerminalEmulator();
        this.termContainer = React.createRef();
        this.termInput = '';
    }

    /// Access the logger
    protected get logger() {
        return this.props.appContext.logger;
    }
    /// Access the database
    protected get database() {
        return this.props.appContext.platform!.database;
    }

    /// Render the demo
    public render() {
        return (
            <div className={styles.root}>
                <div ref={this.termContainer} className={styles.term_container}></div>
            </div>
        );
    }

    /// Evaluate the terminal input
    protected async evalTermInput(text: string) {
        const result = await this.database.use(async conn => {
            return await conn.runQuery(text);
        });

        for (const row of result) {
            this.term.printLine(row.toString());
        }
    }

    /// Run the terminal eval loop
    protected async runTermEvalLoop(text: string | null = null) {
        // Handle terminal input
        if (text != null) {
            await this.evalTermInput(text);
        }

        // Schedule next read
        this.term
            .read('> ', '   ')
            .then(this.runTermEvalLoop.bind(this))
            .catch((txt: string) => {
                this.term.printLine('error: ' + txt);
            });
    }

    public componentDidMount() {
        if (this.termContainer.current != null) {
            // Prepare the terminal
            this.term.open(this.termContainer.current);
            this.term.fit();
            this.term.attach();
            this.term.focus();

            // Start the eval loop
            this.runTermEvalLoop();
        }
    }

    public componentWillUnmount() {
        this.term.detach();
    }
}

export default withAppContext(Terminal);