import * as React from 'react';
import * as styles from './docker_manager.module.css';
import icons from '@ankoh/dashql-svg-symbols';

import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { TextField } from '../foundations/text_field.js';
import { observeSize } from '../foundations/size_observer.js';
import { ValueListBuilder, UpdateValueList } from '../foundations/value_list.js';
import { useDockerClient } from '../../platform/docker/docker_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { DockerCreateContainerSpec } from '../../platform/docker/docker_types.js';

const DEFAULT_REPOSITORY = 'ankoh/hyperdb';
const HYPER_GRPC_PORT = '7484';
const DEFAULT_HYPER_CMD: readonly string[] = [
    'run',
    '--no-password',
    '--skip-license=1',
    '--restrict_dmv_access=false',
    '--init-user=tableau_internal_user',
    '--log_config=cerr,json,all',
    `--listen-connection=tcp.grpc://0.0.0.0:${HYPER_GRPC_PORT}`,
    '--external_allow_custom_endpoints=1',
];
/// Default volume mounts in Docker's "host-path:container-path" form.
/// A leading "~" is expanded to the user's home directory by the native docker proxy.
const DEFAULT_VOLUMES: readonly string[] = [
    '~:/home/local/',
];

interface Props {
    onBack: () => void;
    onClose: () => void;
    onCreated: () => void | Promise<void>;
    hideHeader?: boolean;
}

type Step = 0 | 1 | 2;

function lastPathSegment(repo: string): string {
    const slash = repo.lastIndexOf('/');
    return slash < 0 ? repo : repo.slice(slash + 1);
}

function isHyperRepo(repo: string): boolean {
    return lastPathSegment(repo).toLowerCase().includes('hyper');
}

interface TagState {
    tags: string[];
    loading: boolean;
    done: boolean;
    error: string | null;
}

const initialTagState: TagState = { tags: [], loading: false, done: false, error: null };

export const DockerCreatePanel: React.FC<Props> = (props: Props) => {
    const client = useDockerClient();
    const logger = useLogger();
    const [step, setStep] = React.useState<Step>(0);
    const [repository, setRepository] = React.useState<string>(DEFAULT_REPOSITORY);
    const [filter, setFilter] = React.useState<string>('');
    const [selectedTag, setSelectedTag] = React.useState<string | null>(null);
    const [tagState, setTagState] = React.useState<TagState>(initialTagState);
    const [creating, setCreating] = React.useState(false);
    const [pullStatus, setPullStatus] = React.useState<string | null>(null);
    const [errorText, setErrorText] = React.useState<string | null>(null);
    const [args, setArgs] = React.useState<string[]>([...DEFAULT_HYPER_CMD]);
    const [volumes, setVolumes] = React.useState<string[]>([...DEFAULT_VOLUMES]);
    const tagAbort = React.useRef<AbortController | null>(null);

    const repositoryHyper = React.useMemo(() => isHyperRepo(repository), [repository]);

    // (Re)load tags whenever we enter step 1 or the repository changes.
    React.useEffect(() => {
        if (!client || step !== 1) return;
        tagAbort.current?.abort();
        const ctrl = new AbortController();
        tagAbort.current = ctrl;
        setTagState({ tags: [], loading: true, done: false, error: null });
        setSelectedTag(null);
        (async () => {
            try {
                for await (const page of client.listImageTags(repository, ctrl.signal)) {
                    if (ctrl.signal.aborted) return;
                    setTagState(prev => ({
                        tags: [...prev.tags, ...page.tags],
                        loading: !page.done,
                        done: page.done,
                        error: null,
                    }));
                }
            } catch (e: any) {
                if (!ctrl.signal.aborted) {
                    setTagState({ tags: [], loading: false, done: true, error: e?.message ?? String(e) });
                }
            }
        })();
        return () => {
            ctrl.abort();
        };
    }, [client, step, repository]);

    const filteredTags = React.useMemo(() => {
        const f = filter.trim().toLowerCase();
        if (!f) return tagState.tags;
        return tagState.tags.filter(t => t.toLowerCase().includes(f));
    }, [tagState.tags, filter]);

    const canAdvance: boolean = (() => {
        if (creating) return false;
        switch (step) {
            case 0:
                return repositoryHyper && repository.trim().length > 0;
            case 1:
                return selectedTag != null;
            case 2:
                return true;
        }
    })();

    const handleNext = async () => {
        if (!canAdvance) return;
        if (step < 2) {
            setStep((step + 1) as Step);
            return;
        }
        // step === 2: create
        if (!client || !selectedTag) return;
        setErrorText(null);
        setCreating(true);
        setPullStatus('Pulling image...');
        try {
            for await (const event of client.pullImage(repository, selectedTag)) {
                if (event.errorDetail?.message ?? event.error) {
                    throw new Error(event.errorDetail?.message ?? event.error ?? 'pull failed');
                }
                if (event.status) {
                    const suffix = event.id ? ` ${event.id}` : '';
                    setPullStatus(`${event.status}${suffix}`);
                }
            }
            setPullStatus('Creating container...');
            const spec: DockerCreateContainerSpec = {
                Image: `${repository}:${selectedTag}`,
                Cmd: args.filter(arg => arg.length > 0),
                Labels: { dashql: 'managed' },
                ExposedPorts: { [`${HYPER_GRPC_PORT}/tcp`]: {} },
                HostConfig: {
                    PortBindings: {
                        [`${HYPER_GRPC_PORT}/tcp`]: [{ HostPort: HYPER_GRPC_PORT }],
                    },
                    RestartPolicy: { Name: 'no' },
                    Binds: volumes.filter(vol => vol.length > 0),
                },
            };
            await client.createContainer(spec);
            setPullStatus(null);
            await props.onCreated();
        } catch (e: any) {
            setErrorText(e?.message ?? String(e));
            logger.warn('docker create failed', { error: e?.message ?? String(e) }, 'docker');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className={props.hideHeader ? styles.root_no_header : styles.root}>
            {!props.hideHeader && (
                <div className={styles.header}>
                    <div className={styles.header_left}>
                        <div className={styles.title}>Docker</div>
                    </div>
                    <div className={styles.header_actions}>
                        <IconButton
                            variant={ButtonVariant.Invisible}
                            aria-label="close-overlay"
                            onClick={props.onClose}
                        >
                            <XIcon />
                        </IconButton>
                    </div>
                </div>
            )}
            <div className={styles.wizard_toolbar}>
                <IconButton
                    variant={ButtonVariant.Invisible}
                    aria-label="Cancel"
                    description="Cancel"
                    onClick={props.onBack}
                    disabled={creating}
                >
                    <XIcon />
                </IconButton>
                <IconButton
                    variant={ButtonVariant.Invisible}
                    aria-label="Back"
                    description="Back"
                    onClick={() => setStep((step - 1) as Step)}
                    disabled={step === 0 || creating}
                >
                    <ChevronLeftIcon />
                </IconButton>
                <StepIndicator step={step} />
                <IconButton
                    variant={ButtonVariant.Invisible}
                    aria-label={step === 2 ? 'Create' : 'Next'}
                    description={step === 2 ? (creating ? 'Creating…' : 'Create') : 'Next'}
                    onClick={handleNext}
                    disabled={!canAdvance}
                >
                    {step === 2 ? (
                        <svg className={styles.wizard_toolbar_icon} aria-hidden="true">
                            <use xlinkHref={`${icons}#rocket_16`} />
                        </svg>
                    ) : (
                        <ChevronRightIcon />
                    )}
                </IconButton>
            </div>
            {step === 1 ? (
                <div className={styles.create_root_flush}>
                    <TagStep
                        filter={filter}
                        onFilterChange={setFilter}
                        creating={creating}
                        filteredTags={filteredTags}
                        totalTags={tagState.tags.length}
                        loading={tagState.loading}
                        error={tagState.error}
                        selectedTag={selectedTag}
                        onSelect={(tag) => {
                            setSelectedTag(tag);
                            setStep(2);
                        }}
                    />
                </div>
            ) : (
                <div className={styles.create_root}>
                    {step === 0 && (
                        <>
                            <TextField
                                name="Repository"
                                caption="Examples: ankoh/hyperdb, registry.example.com/team/repo"
                                value={repository}
                                onChange={(e) => setRepository(e.target.value)}
                                disabled={creating}
                                logContext="docker_create"
                            />
                            {!repositoryHyper && (
                                <div className={styles.error_text}>
                                    Only Hyper images are supported (the last path segment must contain &quot;hyper&quot;).
                                </div>
                            )}
                        </>
                    )}
                    {step === 2 && (
                        <>
                            <div className={styles.create_field_group}>
                                <div className={styles.create_section_label}>Image</div>
                                <div className={styles.hyper_settings}>
                                    <div className={styles.hyper_setting_row}>
                                        {repository}:{selectedTag}
                                    </div>
                                </div>
                            </div>
                            <div className={styles.create_field_group}>
                                <ValueListBuilder
                                    className={styles.mono_value_list}
                                    title="Arguments"
                                    caption="Prepopulated with the recommended defaults; edit or remove as needed"
                                    addButtonLabel="Add argument"
                                    elements={args}
                                    modifyElements={(updater: UpdateValueList) => setArgs(prev => updater(prev))}
                                    disabled={creating}
                                    readOnly={creating}
                                />
                            </div>
                            <div className={styles.create_field_group}>
                                <ValueListBuilder
                                    className={styles.mono_value_list}
                                    title="Volumes"
                                    caption="Mounts in host-path:container-path form; a leading ~ expands to your home directory"
                                    addButtonLabel="Add volume"
                                    elements={volumes}
                                    modifyElements={(updater: UpdateValueList) => setVolumes(prev => updater(prev))}
                                    disabled={creating}
                                    readOnly={creating}
                                />
                            </div>
                            {pullStatus && <div className={styles.tag_progress}>{pullStatus}</div>}
                            {errorText && <div className={styles.error_text}>{errorText}</div>}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

interface TagStepProps {
    filter: string;
    onFilterChange: (next: string) => void;
    creating: boolean;
    filteredTags: string[];
    totalTags: number;
    loading: boolean;
    error: string | null;
    selectedTag: string | null;
    onSelect: (tag: string) => void;
}

const TagStep: React.FC<TagStepProps> = (props) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const containerSize = observeSize(containerRef);
    const containerWidth = containerSize?.width ?? 200;
    const containerHeight = containerSize?.height ?? 100;
    return (
        <div className={styles.tag_step}>
            <div className={styles.tag_subheader}>
                <div className={styles.tag_subheader_label}>Tag</div>
                <div className={styles.tag_filter}>
                    <svg className={styles.tag_filter_icon} aria-hidden="true">
                        <use xlinkHref={`${icons}#search_16`} />
                    </svg>
                    <input
                        className={styles.tag_filter_input}
                        type="text"
                        value={props.filter}
                        placeholder={
                            props.error
                                ? `error: ${props.error}`
                                : props.loading
                                    ? 'Filter… (loading)'
                                    : 'Filter'
                        }
                        onChange={(e) => props.onFilterChange(e.target.value)}
                        disabled={props.creating}
                    />
                </div>
            </div>
            <div className={styles.tag_list_container} ref={containerRef}>
                {props.filteredTags.length > 0 ? (
                    <List
                        style={{ width: containerWidth, height: containerHeight }}
                        rowCount={props.filteredTags.length}
                        rowHeight={28}
                        rowComponent={TagRow}
                        rowProps={{
                            tags: props.filteredTags,
                            selectedTag: props.selectedTag,
                            onSelect: props.onSelect,
                        }}
                    />
                ) : (
                    <div className={styles.empty_state}>
                        {props.loading ? 'Loading tags…' : 'No tags match'}
                    </div>
                )}
            </div>
        </div>
    );
};

interface TagRowProps {
    tags: string[];
    selectedTag: string | null;
    onSelect: (tag: string) => void;
}

const TagRow = (props: RowComponentProps<TagRowProps>) => {
    const tag = props.tags[props.index];
    if (!tag) return <div style={props.style} />;
    const selected = tag === props.selectedTag;
    return (
        <div
            style={props.style}
            className={`${styles.tag_row} ${selected ? styles.selected : ''}`}
            onClick={() => props.onSelect(tag)}
        >
            {tag}
        </div>
    );
};

/// Three dots connected by two edges; each edge is split into two halves so we
/// can render the "current dot + first half of the next edge" blue and leave
/// the rest grey, as requested.
///
/// At step 0: dot 0 + half 0 (first half of edge 0) blue.
/// At step 1: dots 0, 1 + halves 0, 1 (full edge 0) + half 2 (first half of edge 1) blue.
/// At step 2: everything blue.
const StepIndicator: React.FC<{ step: Step }> = ({ step }) => {
    const dotActive = (i: number) => i <= step;
    // Halves are indexed left-to-right: 0,1 belong to edge 0 (between dots 0 and 1),
    // 2,3 belong to edge 1 (between dots 1 and 2). A half is active iff
    // ceil(i/2) <= step.
    const halfActive = (i: number) => Math.ceil(i / 2) <= step;
    return (
        <div className={styles.step_indicator}>
            <span className={`${styles.step_dot} ${dotActive(0) ? styles.step_dot_active : ''}`} />
            <span className={`${styles.step_edge_half} ${halfActive(0) ? styles.step_edge_half_active : ''}`} />
            <span className={`${styles.step_edge_half} ${halfActive(1) ? styles.step_edge_half_active : ''}`} />
            <span className={`${styles.step_dot} ${dotActive(1) ? styles.step_dot_active : ''}`} />
            <span className={`${styles.step_edge_half} ${halfActive(2) ? styles.step_edge_half_active : ''}`} />
            <span className={`${styles.step_edge_half} ${halfActive(3) ? styles.step_edge_half_active : ''}`} />
            <span className={`${styles.step_dot} ${dotActive(2) ? styles.step_dot_active : ''}`} />
        </div>
    );
};
