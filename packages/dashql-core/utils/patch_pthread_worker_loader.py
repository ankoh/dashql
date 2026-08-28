#!/usr/bin/env python3

import pathlib
import sys


def replace_once(source: str, old: str, new: str) -> str:
    if source.count(old) != 1:
        raise RuntimeError(f"expected exactly one Emscripten loader fragment, found {source.count(old)}")
    return source.replace(old, new, 1)


input_path = pathlib.Path(sys.argv[1])
output_path = pathlib.Path(sys.argv[2])
source = input_path.read_text()

source = replace_once(
    source,
    """    worker.postMessage({
      cmd: "load",
      handlers,
      wasmMemory,
      wasmModule,
      "workerID": worker.workerID
    });""",
    """    var loadMessage = {
      cmd: "load",
      handlers,
      wasmMemory,
      wasmModule,
      "workerID": worker.workerID
    };
    try {
      worker.postMessage(loadMessage);
    } catch (error) {
      var uncloneable = [];
      if (typeof structuredClone == "function") {
        for (var [name, value] of Object.entries(loadMessage)) {
          try {
            structuredClone(value);
          } catch (cloneError) {
            uncloneable.push(`${name}: ${cloneError}`);
          }
        }
      }
      var isolation = typeof crossOriginIsolated == "undefined" ? "unavailable" : crossOriginIsolated;
      var sharedBuffer = wasmMemory?.buffer instanceof SharedArrayBuffer;
      throw new Error(`Unable to initialize DashQL pthread worker (crossOriginIsolated=${isolation}, sharedWasmMemory=${sharedBuffer}, uncloneable=[${uncloneable.join(", ")}])`, { cause: error });
    }""",
)

output_path.write_text(source)
