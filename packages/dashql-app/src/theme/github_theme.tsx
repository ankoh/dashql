import * as React from "react";

import * as style from './github_theme.module.css';

export function GitHubTheme(props: { children: React.ReactElement }) {
    return (
        <div className={style.base_style}>
            {props.children}
        </div>
    );
}
