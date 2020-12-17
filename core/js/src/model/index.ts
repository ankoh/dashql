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
import { ActionVariant } from "./state_mutation";

// The action dispatch
export type Dispatch = (action: ActionVariant) => void;
// The store type
export type DerivedReduxStore = Store<CoreState>;
