#include "dashql/visualize/umap.h"

#include <string>

namespace dashql::visualize {

namespace {

std::string ResolveFieldName(const AnalyzedScript& script, uint32_t expression_id) {
    const auto& expression = script.expressions[expression_id];
    if (const auto* column = std::get_if<AnalyzedScript::Expression::ColumnRef>(&expression.inner)) {
        return std::string(column->column_name.column_name.get().text);
    }
    auto span = script.parsed_script->scanned_script->ResolveTextSpan(
        script.parsed_script->nodes[expression.ast_node_id].symbol_span());
    auto input = script.parsed_script->scanned_script->GetInput();
    return std::string(input.substr(span.offset(), span.length()));
}

}  // namespace

std::shared_ptr<UmapDocument> CompileUmapSpec(const VisualizationSpec& spec, const AnalyzedScript& script) {
    if (spec.umap_model) return spec.umap_model;
    if (!spec.umap) return nullptr;

    const auto& input = *spec.umap;
    auto out = std::make_shared<UmapDocument>();
    if (input.vector_expression_id) out->vector_column = ResolveFieldName(script, *input.vector_expression_id);
    if (input.category_expression_id) out->category_column = ResolveFieldName(script, *input.category_expression_id);
    if (input.label_expression_id) out->label_column = ResolveFieldName(script, *input.label_expression_id);

    out->projection = std::make_unique<buffers::visualization::UmapProjectionSpecT>();
    out->projection->method = buffers::visualization::UmapProjectionMethod::UMAP;
    if (input.projection.metric) out->projection->metric = std::string(*input.projection.metric);
    if (input.projection.neighbors) out->projection->neighbors = *input.projection.neighbors;
    if (input.projection.min_dist) out->projection->min_dist = *input.projection.min_dist;

    spec.umap_model = out;
    return out;
}

flatbuffers::Offset<buffers::visualization::UmapSpec> PackUmapSpec(flatbuffers::FlatBufferBuilder& builder,
                                                                  const UmapDocument& spec) {
    return buffers::visualization::CreateUmapSpec(builder, &spec);
}

}  // namespace dashql::visualize
