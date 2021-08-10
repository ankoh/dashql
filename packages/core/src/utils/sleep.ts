// Copyright (c) 2021 The DashQL Authors

export async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
