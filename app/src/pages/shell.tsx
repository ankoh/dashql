import * as React from "react";
import { TerminalLoader } from "../components";
import styles from "./shell.module.css";

class Shell extends React.Component {
    public render() {
        return (
            <TerminalLoader className={styles.terminal} />
        );
    }
}

export default Shell;
