export * from "./action";
export * from "./cache";
export * from "./log";
export * from "./plan";
export * from "./program";
export * from "./state";
export * from "./state_mutation";
export * from "./persistent_state";
export * from "./store";

import { StateMutationVariant } from "./state_mutation";

// The action dispatch
export type Dispatch = (action: StateMutationVariant) => void;
