import * as React from 'react';
import { AppReduxStore, Dispatch } from '../store';
import { IAppContext, withAppContext } from '../app_context';
import { connect } from 'react-redux';
import classNames from 'classnames';

import 'xterm/css/xterm.css';
import styles from './terminal.module.css';

/// The terminal props
interface ITerminalProps {
    appContext: IAppContext;
    className?: string;
}

/// A terminal
class Terminal extends React.Component<ITerminalProps> {
    protected termContainer: React.RefObject<HTMLDivElement>;
    protected input: string;

    /// Constructor
    constructor(props: ITerminalProps) {
        super(props);
        this.termContainer = React.createRef();
        this.input = "";
    }

    /// Render the terminal
    public render() {
        return (
            <div ref={this.termContainer} className={classNames(styles.terminal_container, this.props.className)}>
            </div>
        );
    }

    /// Evaluate the terminal input
    protected async eval(text: string) {
        /// XXX
        // this.props.appContext.duckdb.query(text);
    }

    /// Read eval print loop
    protected async evalLoop(text: string | null = null) {
        if (text != null) {
            await this.eval(text);
        }

        // Schedule next read
        let term = this.props.appContext.ctrl.terminal;
        term.read("> ",  "   ",)
            .then(this.evalLoop.bind(this))
            .catch(function(text: string) {
                term.printLine("error: " + text);
            });
    }

    /// Component did mount to the dom
    public componentDidMount() {
        if (this.termContainer.current != null) {
            let ctrl = this.props.appContext.ctrl;
            ctrl.terminal.reset();
            ctrl.terminal.open(this.termContainer.current);
            ctrl.terminal.fit();
            ctrl.terminal.attach();
            ctrl.terminal.focus();
            this.evalLoop();
        }
    }

    /// Component did update
    public componentDidUpdate(_prevProps: ITerminalProps) {
    }

    /// Component will unmount from the dom
    public componentWillUnmount() {
        let ctrl = this.props.appContext.ctrl;
        ctrl.terminal.detach();
    }
}

function mapStateToProps(_state: AppReduxStore) {
    return {};
}
function mapDispatchToProps(_dispatch: Dispatch) {
    return {};
}

export default withAppContext(connect(mapStateToProps, mapDispatchToProps)(Terminal));

