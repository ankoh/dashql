import * as React from "react";

import { useLogger } from "../logger/logger_provider.js";
import { isNativePlatform } from "../native_globals.js";
import { DockerClient } from "./docker_client.js";
import { NativeDockerClient } from "./native_docker_client.js";

type Props = {
    children: React.ReactElement;
};

const CLIENT_CTX = React.createContext<DockerClient | null>(null);
export const useDockerClient = (): DockerClient | null => React.useContext(CLIENT_CTX);

export const DockerClientProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const [client, setClient] = React.useState<DockerClient | null>(null);
    React.useEffect(() => {
        if (isNativePlatform()) {
            setClient(new NativeDockerClient({ proxyEndpoint: new URL("dashql-native://localhost") }, logger));
        } else {
            setClient(null);
        }
    }, [logger]);
    return <CLIENT_CTX.Provider value={client}>{props.children}</CLIENT_CTX.Provider>;
};
