import * as React from "react";
import {ModuleInspector} from "../components";
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
            <ModuleInspector className={styles.inspector} />
        );
    }
};
