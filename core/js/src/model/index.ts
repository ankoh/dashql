export * from "./buffer";
export * from "./log";
export * from "./plan";
export * from "./program";
export * from "./state";
export * from "./state_mutation";

import { Store } from "redux";
import { State } from "./state";
import { ActionVariant } from "./state_mutation";

// The action dispatch
export type Dispatch = (action: ActionVariant) => void;
// The store type
export type AppReduxStore = Store<State>;
