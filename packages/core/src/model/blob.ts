// Copyright (c) 2020 The DashQL Authors

import { PlanObject } from './plan_object';

/// A blob path
export interface BlobRef extends PlanObject {
    /// The qualified table name
    readonly nameQualified: string;
    /// The blob path
    readonly blobPath: string;
}
