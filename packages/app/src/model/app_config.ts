export interface AppConfig {
    program: string;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function isAppConfig(object: any): object is AppConfig {
    return object.program !== undefined;
}
