// Copyright (c) 2020 The DashQL Authors

import { JMESPathModule } from './jmespath_wasm';
export function JMESPath(moduleOverrides?: Partial<JMESPathModule>): Promise<JMESPathModule>;
export default JMESPath;
