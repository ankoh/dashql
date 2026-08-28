export function architectureName(arch: string): "arm64" | "x64" {
    if (arch === "arm64" || arch === "x64") return arch;
    throw new Error(`Unsupported update architecture: ${arch}`);
}

export function updateFeedUrl(version: string, arch: string): string {
    const channel = version.includes("-") ? "canary" : "stable";
    return `https://get.dashql.app/channels/${channel}/macos/${architectureName(arch)}`;
}
