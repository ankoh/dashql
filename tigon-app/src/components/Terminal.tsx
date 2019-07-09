import * as React from 'react';
import * as Store from '../store';
import * as xterm from 'xterm';
import * as fit from 'xterm/lib/addons/fit/fit';
import { connect } from 'react-redux';

import 'xterm/dist/xterm.css';
import './Terminal.css';

interface ITerminalProps {
}

class Terminal extends React.Component<ITerminalProps> {
    protected termContainer: React.RefObject<HTMLDivElement>;
    protected term: xterm.Terminal;

    constructor(props: ITerminalProps) {
        super(props);

        xterm.Terminal.applyAddon(fit);

        this.termContainer = React.createRef();
        this.term = new xterm.Terminal();
    }

    public render() {
        return (
            <div className="Terminal">
                <div ref={this.termContainer} className="Terminal-XTerm">
                </div>
            </div>
        );
    }

    public componentDidMount() {
        if (this.termContainer.current != null) {
            this.term.open(this.termContainer.current);
            fit.fit(this.term);

            this.term.write('Hello from \x1B[1;3;31mxterm.js\x1B[0m $ ')
            this.term.on('key', (key, ev) => {
                console.log(key.charCodeAt(0));
                if (key.charCodeAt(0) === 13)
                    this.term.write('\n');
                this.term.write(key);
            });
        }
    }

    public componentDidUpdate() {
    }

    public componentWillUnmount() {
        this.term.dispose();
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
    };
}
function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {
    };
}

export default connect(mapStateToProps, mapDispatchToProps)(Terminal);

