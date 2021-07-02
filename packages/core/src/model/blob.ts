// Copyright (c) 2020 The DashQL Authors

import * as proto from '@dashql/proto';
import { PlanObject } from './plan_object';

/// A blob path
export interface BlobRef extends PlanObject {
    /// The file path
    readonly filePath: string;
    /// The archive mode (if any)
    readonly archiveMode: proto.analyzer.ArchiveMode;
}
