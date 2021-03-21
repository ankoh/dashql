export interface AppConfig {
    program?: string;
}

export function isAppConfig(object: any): object is AppConfig {
    return true;
}
