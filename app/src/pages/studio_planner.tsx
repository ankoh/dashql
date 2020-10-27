import * as React from "react";
import styles from './studio.module.css';

export class Planner extends React.Component<{}> {
    constructor(props: {}) {
        super(props);
        this.state = {
            vizExpanded: false,
        };
    }
    public render() {
        return (
            <div className={styles.inspector} />
        );
    }
};
