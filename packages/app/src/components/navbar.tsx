import * as React from 'react';
import SystemIndicators from './system_indicators';
import classNames from 'classnames';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import Avatar from 'react-avatar';
import Button from 'react-bootstrap/Button';
import { auth } from '../auth';

import styles from './navbar.module.css';

import logo from '../../static/svg/logo/logo.svg';
import icon_examples from '../../static/svg/icons/library_books.svg';
import icon_studio from '../../static/svg/icons/dashboard.svg';

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
                        <svg className={styles.tab_icon} width="20px" height="20px">
                            <use xlinkHref={`${icon}#sym`} />
                        </svg>
                    </Button>
                </Link>
            </div>
        );
    };
}
const StudioTab = createTab('/studio', icon_studio);
const ExamplesTab = createTab('/examples', icon_examples);

interface RouteParams {}
interface Props extends RouteComponentProps<RouteParams> {}

class NavBarImpl extends React.Component<Props> {
    constructor(props: Props) {
        super(props);
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
                <SystemIndicators className={styles.systemlist} />
            </div>
        );
    }
}

export const NavBar = withRouter(NavBarImpl);

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
