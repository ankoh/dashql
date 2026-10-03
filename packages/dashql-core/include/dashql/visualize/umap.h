#pragma once

#include <flatbuffers/flatbuffer_builder.h>

#include <memory>

#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"

namespace dashql::visualize {

using UmapDocument = buffers::visualization::UmapSpecT;

std::shared_ptr<UmapDocument> CompileUmapSpec(const VisualizationSpec& spec, const AnalyzedScript& script);

flatbuffers::Offset<buffers::visualization::UmapSpec> PackUmapSpec(flatbuffers::FlatBufferBuilder& builder,
                                                                  const UmapDocument& spec);

}  // namespace dashql::visualize
