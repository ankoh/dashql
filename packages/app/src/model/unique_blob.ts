// Copyright (c) 2020 The DashQL Authors

import * as proto from '@dashql/proto';
import { PlanObject } from './plan_object';

/// A blob path
export interface UniqueBlob extends PlanObject {
    /// The blob
    readonly blob: Blob;
    /// The archive mode (if any)
    readonly archiveMode: proto.analyzer.ArchiveMode;
}
