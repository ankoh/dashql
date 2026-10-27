import * as React from 'react';

import { Button, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { TextInput, TextInputValidationStatus } from '../../ui/foundations/text_input.js';
import { parseHyperLinkTarget } from '../../app/hyper_link/hyper_link_target.js';
import { parseHyperLinkText, type DemoDataSourceParams } from './data_source.js';
import * as styles from './data_source_picker.module.css';

/// The kind of a data source
export type DemoDataSourceKind = DemoDataSourceParams['kind'];

const KINDS: { kind: DemoDataSourceKind; label: string }[] = [
    { kind: 'wasm', label: 'This browser' },
    { kind: 'remote', label: 'Remote Hyper' },
];

/// The endpoint of `hyperd run --ui`
const DEFAULT_ENDPOINT = 'http://127.0.0.1:7484';

interface Props {
    /// The connected source, null while the remote Hyper is entered
    value: DemoDataSourceParams | null;
    /// Connect another source, null while a remote Hyper is entered
    onChange: (params: DemoDataSourceParams | null) => void;
    /// The initial kind
    initialKind?: DemoDataSourceKind;
}

/// Pick the Hyper of a demo: the HyperDB WASM of the page, or a remote Hyper with the HTTP v3 API.
/// The token of a remote Hyper stays in memory, it is never stored.
export const DataSourcePicker: React.FC<Props> = (props: Props) => {
    const [kind, setKind] = React.useState<DemoDataSourceKind>(props.value?.kind ?? props.initialKind ?? 'wasm');
    const [endpoint, setEndpoint] = React.useState(props.value?.kind === 'remote' ? props.value.target.endpoint : DEFAULT_ENDPOINT);
    const [token, setToken] = React.useState('');

    const selectKind = (index: number) => {
        const next = KINDS[index].kind;
        setKind(next);
        props.onChange(next === 'wasm' ? { kind: 'wasm' } : null);
    };

    // A pasted link of `hyperd run --ui` fills the endpoint and the token
    const changeEndpoint = (text: string) => {
        const link = parseHyperLinkText(text);
        if (link != null) {
            setEndpoint(link.endpoint);
            setToken(link.token);
        } else {
            setEndpoint(text);
        }
    };

    const target = parseHyperLinkTarget(endpoint, token);
    const endpointValid = parseHyperLinkTarget(endpoint, 'token') != null;
    const connected = props.value?.kind === 'remote' && target != null
        && props.value.target.endpoint === target.endpoint && props.value.target.token === target.token;

    return (
        <div className={styles.root}>
            <SegmentedControl aria-label="Data source" data-testid="data-source-kind" size={SegmentedControlSize.Small} onChange={selectKind}>
                {KINDS.map(k => (
                    <SegmentedControl.Button key={k.kind} selected={k.kind === kind}>{k.label}</SegmentedControl.Button>
                ))}
            </SegmentedControl>
            {kind === 'remote' && (
                <form
                    className={styles.remote}
                    onSubmit={e => {
                        e.preventDefault();
                        if (target != null) props.onChange({ kind: 'remote', target });
                    }}
                >
                    <TextInput
                        className={styles.endpoint}
                        aria-label="Endpoint"
                        placeholder="Endpoint or Hyper link"
                        value={endpoint}
                        onChange={e => changeEndpoint(e.target.value)}
                        validationStatus={endpoint.length > 0 && !endpointValid ? TextInputValidationStatus.Error : undefined}
                        data-testid="data-source-endpoint"
                    />
                    <TextInput
                        className={styles.token}
                        aria-label="Token"
                        placeholder="Token"
                        type="password"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        data-testid="data-source-token"
                    />
                    <Button
                        type="submit"
                        size={ButtonSize.Small}
                        variant={connected ? ButtonVariant.Default : ButtonVariant.Primary}
                        disabled={target == null}
                    >
                        {connected ? 'Reconnect' : 'Connect'}
                    </Button>
                </form>
            )}
        </div>
    );
};
