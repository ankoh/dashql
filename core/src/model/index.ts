export * from "./action";
export * from "./buffer";
export * from "./cache";
export * from "./log";
export * from "./plan";
export * from "./program";
export * from "./state";
export * from "./state_mutation";
export * from "./persistent_state";

import { Store } from "redux";
import { CoreState } from "./state";
import { StateMutationVariant } from "./state_mutation";

// The action dispatch
export type Dispatch = (action: StateMutationVariant) => void;
// The store type
export type DerivedReduxStore = Store<CoreState>;
