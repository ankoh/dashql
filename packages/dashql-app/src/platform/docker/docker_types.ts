export interface DockerContainerSummary {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
    Labels: Record<string, string>;
}

export interface DockerCreateContainerSpec {
    Image: string;
    Cmd?: string[];
    Labels?: Record<string, string>;
    ExposedPorts?: Record<string, Record<string, never>>;
    HostConfig?: {
        PortBindings?: Record<string, { HostIp?: string; HostPort: string }[]>;
        RestartPolicy?: { Name: string; MaximumRetryCount?: number };
    };
}

export interface DockerLogChunk {
    /// Stream type: 0=stdin, 1=stdout, 2=stderr (Docker frame header), or -1 if framing unavailable.
    stream: number;
    /// UTF-8 decoded text.
    text: string;
}

export interface DockerImageTagPage {
    /// Tags returned in this page.
    tags: string[];
    /// Whether more pages are coming.
    done: boolean;
}

export interface DockerPullProgress {
    /// Free-form progress event from Docker (status, progress, errorDetail, etc.).
    status?: string;
    progress?: string;
    progressDetail?: { current?: number; total?: number };
    error?: string;
    errorDetail?: { message?: string };
    id?: string;
}
