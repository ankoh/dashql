export interface DockerContainerPort {
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
    IP?: string;
}

export interface DockerContainerSummary {
    Id: string;
    Names: string[];
    Image: string;
    State: string;
    Status: string;
    Labels: Record<string, string>;
    Ports: DockerContainerPort[];
}

/// Hyper's default in-container gRPC port; matches docker_create_panel.tsx HYPER_GRPC_PORT.
const HYPER_GRPC_PRIVATE_PORT = 7484;

/// Pick the host-side TCP port that exposes Hyper.
/// Prefers the entry whose PrivatePort is 7484; otherwise returns the first TCP entry's PublicPort.
/// Returns null if no TCP port is published.
export function pickHyperPort(c: DockerContainerSummary): number | null {
    const tcpPorts = (c.Ports ?? []).filter(p => p.Type === 'tcp' && p.PublicPort != null);
    if (tcpPorts.length === 0) return null;
    const preferred = tcpPorts.find(p => p.PrivatePort === HYPER_GRPC_PRIVATE_PORT);
    return (preferred ?? tcpPorts[0]).PublicPort ?? null;
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
