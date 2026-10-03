#pragma once

#include <memory>
#include <string>

#include "dashql/script.h"

namespace dashql::visualize {

using MarkdownNode = buffers::visualization::MarkdownNodeT;
using MarkdownDocument = buffers::visualization::MarkdownSpecT;

/// Compile a Markdown row template into a safe, renderer-neutral document AST.
std::shared_ptr<MarkdownDocument> CompileMarkdownSpec(const VisualizationSpec& spec);

/// Pack a compiled document into the shared visualization FlatBuffer schema.
flatbuffers::Offset<buffers::visualization::MarkdownSpec> PackMarkdownSpec(
    flatbuffers::FlatBufferBuilder& builder, const MarkdownDocument& spec);

}  // namespace dashql::visualize
