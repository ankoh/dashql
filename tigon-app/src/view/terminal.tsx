import * as React from 'react';
import * as Model from '../model';
import * as xterm from 'xterm';
import * as fit from 'xterm/lib/addons/fit/fit';
import { connect } from 'react-redux';

import 'xterm/dist/xterm.css';
import './terminal.css';

import { IAppContext, withAppContext } from '../app_context';

xterm.Terminal.applyAddon(fit);

interface ITerminalProps {
    appContext: IAppContext;
}

class Terminal extends React.Component<ITerminalProps> {
    protected termContainer: React.RefObject<HTMLDivElement>;
    protected term: xterm.Terminal;
    protected buffer: String;

    constructor(props: ITerminalProps) {
        super(props);

        this.termContainer = React.createRef();
        this.term = new xterm.Terminal();
        this.buffer = "";
    }

    public render() {
        return (
            <div className="Terminal">
                <div ref={this.termContainer} className="Terminal-Container">
                </div>
            </div>
        );
    }

    public componentDidMount() {
        if (this.termContainer.current != null) {
            this.term.open(this.termContainer.current);
            fit.fit(this.term);

            this.term.focus();

            let ctrl = this.props.appContext.ctrl;
            this.term.on('key', (key, ev) => {
                if (key.charCodeAt(0) === 13) {
                    this.buffer += '\n';
                    this.term.write('\n');
                }
                this.buffer += key;
                this.term.write(key);

                if (key.charCodeAt(0) === 59) {
                    this.term.write('\n');
                    let result = ctrl.runQuery(this.buffer.toString());
                    console.log(result);
                    result.destroy();
                    this.buffer = '';
                }
            });

            this.term.setOption('theme', {
                background: 'rgb(0, 0, 0)',
                foreground: 'rgb(255, 255, 255)',
                cursor: 'rgb(255, 255, 255)'
            });
        }
    }

    public componentDidUpdate() {
    }

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

