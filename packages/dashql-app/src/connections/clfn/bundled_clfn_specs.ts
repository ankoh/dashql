import type { ClientFunctionSpec } from '@ankoh/dashql/platform/connections/clfn/clfn_spec';
import { provideClientFunctionSpecs } from '@ankoh/dashql/platform/connections/clfn/clfn_specs';

// The client function specs of extensions/ as chunks of the bundle, every page that may run a client function imports
// this module once
provideClientFunctionSpecs(import.meta.glob<ClientFunctionSpec>('@dashql/extensions/*/clfn/spec/spec.json', { import: 'default' }));
