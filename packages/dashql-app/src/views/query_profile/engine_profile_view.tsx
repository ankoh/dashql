import * as React from 'react';

import * as dashql from '@akohn/dashql';
import {
    EngineProfileView as EngineProfile,
    useQueryProfile as useEngineQueryProfile,
    type EngineProfileViewProps as EngineProfileProps,
    type QueryProfileState,
} from '@akohn/dashql-react/components/query_profile/engine_profile_view';
import { useDashQLCoreSetup } from '../../runtime/core_provider.js';

export type { QueryProfileState };

// The plan of an engine as a query profile in the app (EngineProfileView of @akohn/dashql-react): the core of the app
// loads the plan

export type EngineProfileViewProps = Omit<EngineProfileProps, 'setupCore'>;

/// The plan of an engine as a query profile of the core of the app
export function useQueryProfile(engine: dashql.buffers.profile.ProfileEngine, planText: string | null): QueryProfileState {
    return useEngineQueryProfile(engine, planText, useDashQLCoreSetup());
}

/// The plan text of an engine as a query profile
export function EngineProfileView(props: EngineProfileViewProps) {
    return <EngineProfile {...props} setupCore={useDashQLCoreSetup()} />;
}
