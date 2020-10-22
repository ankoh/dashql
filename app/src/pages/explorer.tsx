import * as React from "react";
import { TerminalLoader } from "../components";
import styles from "./explorer.module.css";

class Explorer extends React.Component {
    public render() {
        return (
            <TerminalLoader className={styles.terminal} />
        );
    }
}

export default Explorer;
