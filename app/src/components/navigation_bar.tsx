import * as React from 'react';
import ActionList from './action_list';
import LogViewer from './log_viewer';
import DatabaseStats from './database_stats';
import classNames from 'classnames';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import Avatar from 'react-avatar';
import Button from 'react-bootstrap/Button';
import { auth } from '../auth';

import styles from './navigation_bar.module.css';

import logo from '../../static/svg/logo/logo.svg';
import icon_database from '../../static/svg/icons/database_white.svg';
import icon_examples from '../../static/svg/icons/library_books_white.svg';
import icon_log from '../../static/svg/icons/log_white.svg';
import icon_studio from '../../static/svg/icons/dashboard_white.svg';
import icon_tasks from '../../static/svg/icons/task_list_white.svg';

interface TabProps {
    pathName: string;
}
function createTab(path: string, icon: string): React.FunctionComponent<TabProps> {
    return (props: TabProps) => {
        return (
            <div
                key={path}
                className={classNames(styles.tab, {
                    [styles.active]: props.pathName == path,
                })}
            >
                <Link to={path}>
                    <Button variant="link">
                        <img src={icon} width="22px" height="22px" />
                    </Button>
                </Link>
            </div>
        );
    };
}
const StudioTab = createTab('/studio', icon_studio);
const ExamplesTab = createTab('/examples', icon_examples);

interface StatusPanelProps {
    icon: string;
    children: JSX.Element;
    statusID: number;
    expandedStatus: number | null;
    onClick: (tab: number) => void;
}

function StatusPanel(props: StatusPanelProps) {
    const Icon = props.icon;
    const expanded = props.statusID == props.expandedStatus;
    return (
        <div
            className={classNames(styles.status, {
                [styles.active]: expanded,
            })}
        >
            <div className={styles.statusicon} onClick={() => props.onClick(props.statusID)}>
                <img src={props.icon} width="22px" height="22px" />
            </div>
            {expanded && <div className={styles.statuspanel}>{props.children}</div>}
        </div>
    );
}

interface RouteParams {}
interface NavigationBarProps extends RouteComponentProps<RouteParams> {}
interface NavigationBarState {
    expandedStatus: number | null;
}

class NavigationBar extends React.Component<NavigationBarProps, NavigationBarState> {
    constructor(props: NavigationBarProps) {
        super(props);
        this.state = {
            expandedStatus: null,
        };
    }

    protected toggleTab(tab: number) {
        this.setState({
            ...this.state,
            expandedStatus: this.state.expandedStatus == tab ? null : tab,
        });
    }

    public render() {
        return (
            <div className={styles.navbar}>
                <div className={styles.logo}>
                    <img src={logo} />
                </div>
                <div className={styles.tabs}>
                    <StudioTab pathName={this.props.location.pathname} />
                    <ExamplesTab pathName={this.props.location.pathname} />
                </div>
                <div className={styles.account} onClick={async () => auth()}>
                    <Avatar githubHandle="ankoh" size="36" round={true} />
                </div>
                <div className={styles.statuslist}>
                    <StatusPanel
                        statusID={0}
                        expandedStatus={this.state.expandedStatus}
                        onClick={this.toggleTab.bind(this)}
                        icon={icon_database}
                    >
                        <DatabaseStats onClose={() => this.toggleTab(0)} />
                    </StatusPanel>
                    <StatusPanel
                        statusID={1}
                        expandedStatus={this.state.expandedStatus}
                        onClick={this.toggleTab.bind(this)}
                        icon={icon_tasks}
                    >
                        <ActionList onClose={() => this.toggleTab(1)} />
                    </StatusPanel>
                    <StatusPanel
                        statusID={2}
                        expandedStatus={this.state.expandedStatus}
                        onClick={this.toggleTab.bind(this)}
                        icon={icon_log}
                    >
                        <LogViewer onClose={() => this.toggleTab(2)} />
                    </StatusPanel>
                </div>
            </div>
        );
    }
}

export const NavBar = withRouter(NavigationBar);

export function withNavBar<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    return (props: P) => {
        return (
            <div className={styles.container}>
                <div className={styles.page}>
                    <Component {...props} />
                </div>
                <NavBar />
            </div>
        );
    };
}
