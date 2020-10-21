import * as React from 'react';
import { withRouter, RouteComponentProps, Link } from 'react-router-dom';
import classNames from 'classnames';

import styles from './navigation_bar.module.css';

interface RouteParams {}
interface Props extends RouteComponentProps<RouteParams> {}

class NavigationBar extends React.Component<Props> {
    public renderTab(path: string, name: string) {
        let active = this.props.location.pathname == path;
        console.log(this.props.location.pathname);
        console.log(active);
        return (
            <div key={path}
                className={classNames(
                    styles.tab,
                    styles.tab_name,
                    {
                        [styles.active]: active
                    },
                )}
            >
                <Link to={path}>
                    {name}
                </Link>
            </div>
        );
    }

    public render() {
        console.log(this.props.location.pathname);
        return (
            <div className={styles.container}>
                <div className={styles.banner}>DashQL</div>
                <div className={styles.tabs}>
                    {this.renderTab('/', 'Explorer')}
                    {this.renderTab('/workbook', 'Workbook')}
                    {this.renderTab('/library', 'Library')}
                </div>
            </div>
        );
    }
}

export default withRouter(NavigationBar);
