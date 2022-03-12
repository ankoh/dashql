import * as React from 'react';
import * as utils from '../../utils';
import { JSONTree } from 'react-json-tree';
import { clsx } from '../../utils';

import styles from './json_viewer.module.css';

const theme: any = {
    scheme: 'rjv-default',
    author: 'mac gainor',
    base00: 'rgb(0, 0, 0)',
    base01: 'rgb(245, 245, 245)',
    base02: 'rgb(235, 235, 235)',
    base03: '#93a1a1',
    base04: 'rgb(0, 0, 0)',
    base05: '#586e75',
    base06: '#073642',
    base07: '#002b36',
    base08: '#d33682',
    base09: '#cb4b16',
    base0A: '#dc322f',
    base0B: '#859900',
    base0C: '#6c71c4',
    base0D: '#586e75',
    base0E: '#2aa198',
    base0F: '#268bd2',
};

enum JSONShape {
    UNRECOGNIZED,
    COLUMN_OBJECT,
    ROW_ARRAY,
}

function identifyJSONShape(obj: any): JSONShape {
    // Detect row array
    if (Array.isArray(obj)) {
        let ok = true;
        for (let i = 0; i < Math.min(obj.length, 10); ++i) {
            ok &&= typeof obj[i] == 'object';
        }
        return ok ? JSONShape.ROW_ARRAY : JSONShape.UNRECOGNIZED;
    }

    // Detect column object
    if (typeof obj == 'object') {
        if (Object.keys(obj).length < 1000) {
            let ok = true;
            for (const key in obj) {
                ok &&= Array.isArray(obj[key]);
            }
            return ok ? JSONShape.COLUMN_OBJECT : JSONShape.UNRECOGNIZED;
        }
        return JSONShape.UNRECOGNIZED;
    }
    return JSONShape.UNRECOGNIZED;
}

interface Props {
    buffer: ArrayBuffer;
}

interface State {
    error: any | null;
    buffer: Uint8Array;
    json: any;
    jsonShape: JSONShape;
}

export class JSONViewer extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = JSONViewer.getDerivedStateFromProps(props, {
            error: null,
            buffer: new Uint8Array(),
            json: {},
            jsonShape: JSONShape.UNRECOGNIZED,
        });
    }

    static getDerivedStateFromProps(props: Props, prevState: State): State {
        const u8Buffer = new Uint8Array(props.buffer);
        try {
            const text = utils.decodeText(u8Buffer);
            const json = JSON.parse(text);
            const jsonShape = identifyJSONShape(json);
            return {
                error: null,
                buffer: u8Buffer,
                json,
                jsonShape,
            };
        } catch (e) {
            return {
                error: e,
                buffer: u8Buffer,
                json: {},
                jsonShape: JSONShape.UNRECOGNIZED,
            };
        }
    }

    public render(): React.ReactElement {
        // Get shape label and class
        let shapeName: string;
        let shapeClass: string;
        switch (this.state.jsonShape) {
            case JSONShape.COLUMN_OBJECT:
                shapeName = 'column object';
                shapeClass = styles.meta_entry_value_shape_recognized;
                break;
            case JSONShape.ROW_ARRAY:
                shapeName = 'row array';
                shapeClass = styles.meta_entry_value_shape_recognized;
                break;
            case JSONShape.UNRECOGNIZED:
                shapeName = 'unknown shape';
                shapeClass = styles.meta_entry_value_shape_unrecognized;
                break;
        }

        return (
            <div className={styles.root}>
                <div className={styles.tree_container}>
                    <JSONTree data={this.state.json} theme={theme} invertTheme={true} />
                </div>
                <div className={styles.meta_table}>
                    <div className={styles.meta_entry_label}></div>
                    <div className={clsx(styles.meta_entry_value, shapeClass)}>{shapeName}</div>
                </div>
            </div>
        );
    }
}

export default JSONViewer;
