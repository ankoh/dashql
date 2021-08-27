// Copyright (c) 2020 The DashQL Authors

// This is a hack to make the generated emscripten output ES6 compatible.

import { dirname } from 'path';
import { createRequire } from 'module';
globalThis.__dirname = dirname(import.meta.url);
globalThis.require = createRequire(import.meta.url);
