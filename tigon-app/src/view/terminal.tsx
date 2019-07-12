import * as React from 'react';
import * as Model from '../model';
import * as xterm from 'xterm';
import * as fit from 'xterm/lib/addons/fit/fit';
import { connect } from 'react-redux';

import 'xterm/dist/xterm.css';
import './terminal.css';

import { IAppContext, withAppContext } from '../app_context';

xterm.Terminal.applyAddon(fit);

/// The terminal props
interface ITerminalProps {
    appContext: IAppContext;
}

/// A terminal
class Terminal extends React.Component<ITerminalProps> {
    protected termContainer: React.RefObject<HTMLDivElement>;
    protected term: xterm.Terminal;
    protected input: string;

    /// Constructor
    constructor(props: ITerminalProps) {
        super(props);

        this.termContainer = React.createRef();
        this.term = new xterm.Terminal();
        this.input = "";
    }

    // Render the terminal
    public render() {
        return (
            <div className="Terminal">
                <div ref={this.termContainer} className="Terminal-Container">
                </div>
            </div>
        );
    }

    /// Component did mount to the dom
    public componentDidMount() {
        if (this.termContainer.current != null) {
            this.term.open(this.termContainer.current);
            fit.fit(this.term);

            this.term.focus();

            let ctrl = this.props.appContext.ctrl;
            this.term.on('key', (key, ev) => {
                if (key.charCodeAt(0) === 13) {
                    this.input += '\n';
                    this.term.write('\n');
                }
                this.input += key;
                this.term.write(key);

                if (key.charCodeAt(0) === 59) {
                    this.term.write('\n');
                    let result = ctrl.core.runQuery(this.input.toString());
                    // let resultBuffer = result.getBuffer();
                    // TODO do something with the data
                    result.destroy();
                    this.input = '';
                }
            });

            this.term.setOption('theme', {
                background: 'rgb(0, 0, 0)',
                foreground: 'rgb(255, 255, 255)',
                cursor: 'rgb(255, 255, 255)'
            });
        }
    }

    /// Component did update
    public componentDidUpdate() {
    }

    /// Component will unmount from the dom
    public componentWillUnmount() {
        this.term.dispose();
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
    };
}
function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {
    };
}

export default withAppContext(connect(mapStateToProps, mapDispatchToProps)(Terminal));

