#include "dashql/analyzer/analyze_visualization_pass.h"

#include <cstdlib>
#include <unordered_map>

#include "dashql/analyzer/analysis_state.h"
#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "dashql/utils/string_trimming.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;

AnalyzeVisualizationPass::AnalyzeVisualizationPass(AnalysisState& state)
    : PassManager::LTRPass(state), node_states(state.ast.size()) {}

void AnalyzeVisualizationPass::NodeState::Clear() {
    encoding_channels.clear();
    mark_type.reset();
    mark.reset();
    title.reset();
    width.reset();
    height.reset();
    scale.reset();
    axis.reset();
    legend.reset();
}

void AnalyzeVisualizationPass::NodeState::MergeFrom(NodeState&& other) {
    encoding_channels.insert(encoding_channels.end(), std::make_move_iterator(other.encoding_channels.begin()),
                             std::make_move_iterator(other.encoding_channels.end()));
    if (!mark_type.has_value() && other.mark_type.has_value()) {
        mark_type = other.mark_type;
    }
    if (!mark.has_value() && other.mark.has_value()) {
        mark = std::move(other.mark);
    }
    if (!title.has_value() && other.title.has_value()) {
        title = other.title;
    }
    if (!width.has_value() && other.width.has_value()) {
        width = other.width;
    }
    if (!height.has_value() && other.height.has_value()) {
        height = other.height;
    }
    if (!scale.has_value() && other.scale.has_value()) {
        scale = std::move(other.scale);
    }
    if (!axis.has_value() && other.axis.has_value()) {
        axis = std::move(other.axis);
    }
    if (!legend.has_value() && other.legend.has_value()) {
        legend = std::move(other.legend);
    }
}

void AnalyzeVisualizationPass::MergeChildStates(NodeState& dst, const buffers::parser::Node& parent) {
    for (size_t i = 0; i < parent.children_count(); ++i) {
        auto child_id = parent.children_begin_or_value() + i;
        dst.MergeFrom(std::move(node_states[child_id]));
    }
}

namespace {

std::optional<std::string_view> ReadTextValue(AnalysisState& state, const buffers::parser::Node* node) {
    if (!node) return std::nullopt;
    switch (node->node_type()) {
        case NodeType::OBJECT_SQL_COLUMN_REF:
        case NodeType::NAME:
        case NodeType::LITERAL_STRING:
            return state.scanned.ReadTextAtSymbolSpan(node->symbol_span());
        default:
            return std::nullopt;
    }
}

/// Read a textual value with surrounding single quotes stripped, so a string
/// literal like `'white'` yields the bare `white` for JSON emission.
std::optional<std::string_view> ReadUnquotedTextValue(AnalysisState& state, const buffers::parser::Node* node) {
    auto text = ReadTextValue(state, node);
    if (!text) return std::nullopt;
    return trim_view(*text, is_no_quote);
}

std::optional<double> ReadNumericValue(AnalysisState& state, const buffers::parser::Node* node) {
    if (!node) return std::nullopt;
    if (node->node_type() == NodeType::LITERAL_INTEGER || node->node_type() == NodeType::LITERAL_FLOAT ||
        node->node_type() == NodeType::OBJECT_SQL_NARY_EXPRESSION) {
        auto text = state.scanned.ReadTextAtSymbolSpan(node->symbol_span());
        char* end = nullptr;
        double val = std::strtod(std::string(text).c_str(), &end);
        if (end && *end == '\0') return val;
    }
    return std::nullopt;
}

std::optional<bool> ReadBoolValue(AnalysisState& state, const buffers::parser::Node* node) {
    if (!node) return std::nullopt;
    if (node->node_type() == NodeType::BOOL) {
        return node->children_begin_or_value() != 0;
    }
    auto text = ReadTextValue(state, node);
    if (!text) return std::nullopt;
    if (*text == "true") return true;
    if (*text == "false") return false;
    return std::nullopt;
}

uint32_t NodeId(AnalysisState& state, const buffers::parser::Node* node) { return node - state.ast.data(); }

/// Recursively extract a mark definition from an OBJECT_VIS_MARK node.
/// Mark properties are literals/enums read directly off the AST subtree, so this
/// is self-contained and does not depend on the merge-up node states. `point` and
/// `line` overlays recurse: they are either a boolean toggle or a nested mark.
VisMark ExtractVisMark(AnalysisState& state, const buffers::parser::Node& node) {
    using AttributeKey = buffers::parser::AttributeKey;

    VisMark mark;
    mark.ast_node_id = NodeId(state, &node);

    auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
    for (auto& child : children) {
        switch (child.attribute_key()) {
            case AttributeKey::VIS_MARK_TYPE:
                if (child.node_type() == NodeType::ENUM_VIS_MARK_TYPE) {
                    mark.type = static_cast<buffers::parser::VisMarkType>(child.children_begin_or_value());
                }
                break;
            case AttributeKey::VIS_MARK_POINT:
                if (child.node_type() == NodeType::OBJECT_VIS_MARK) {
                    mark.point = std::make_unique<VisMark>(ExtractVisMark(state, child));
                } else {
                    mark.point_enabled = ReadBoolValue(state, &child);
                }
                break;
            case AttributeKey::VIS_MARK_LINE:
                if (child.node_type() == NodeType::OBJECT_VIS_MARK) {
                    mark.line = std::make_unique<VisMark>(ExtractVisMark(state, child));
                } else {
                    mark.line_enabled = ReadBoolValue(state, &child);
                }
                break;
            case AttributeKey::VIS_MARK_FILLED:
                mark.filled = ReadBoolValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_FILL:
                mark.fill = ReadUnquotedTextValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_STROKE:
                mark.stroke = ReadUnquotedTextValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_COLOR:
                mark.color = ReadUnquotedTextValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_OPACITY:
                mark.opacity = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_FILL_OPACITY:
                mark.fill_opacity = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_STROKE_OPACITY:
                mark.stroke_opacity = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_STROKE_WIDTH:
                mark.stroke_width = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_STROKE_DASH:
                mark.stroke_dash_node_id = NodeId(state, &child);
                break;
            case AttributeKey::VIS_MARK_SIZE:
                mark.size = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_SHAPE:
                mark.shape = ReadUnquotedTextValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_ANGLE:
                mark.angle = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_RADIUS:
                mark.radius = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_CORNER_RADIUS:
                mark.corner_radius = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_ORIENT:
                mark.orient = ReadUnquotedTextValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_INTERPOLATE:
                mark.interpolate = ReadUnquotedTextValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_TENSION:
                mark.tension = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_THICKNESS:
                mark.thickness = ReadNumericValue(state, &child);
                break;
            case AttributeKey::VIS_MARK_TOOLTIP:
                mark.tooltip = ReadBoolValue(state, &child);
                break;
            default:
                break;
        }
    }
    return mark;
}

}  // namespace

void AnalyzeVisualizationPass::Prepare() {}

void AnalyzeVisualizationPass::Visit(std::span<const buffers::parser::Node> morsel) {
    size_t morsel_offset = morsel.data() - state.ast.data();
    for (size_t i = 0; i < morsel.size(); ++i) {
        const buffers::parser::Node& node = morsel[i];
        uint32_t node_id = morsel_offset + i;
        NodeState& node_state = node_states[node_id];

        switch (node.node_type()) {
            case NodeType::OBJECT_VIS_SCALE: {
                VisScale s;
                s.ast_node_id = node_id;

                auto [type_node, domain_node, domain_min_node, domain_max_node, domain_mid_node, range_node,
                      range_min_node, range_max_node, scheme_node, interpolate_node, nice_node, zero_node, clamp_node,
                      padding_node, padding_inner_node, padding_outer_node, reverse_node, round_node, exponent_node,
                      bins_node, name_node] =
                    state.GetAttributes<AttributeKey::VIS_SCALE_TYPE, AttributeKey::VIS_SCALE_DOMAIN,
                                        AttributeKey::VIS_SCALE_DOMAIN_MIN, AttributeKey::VIS_SCALE_DOMAIN_MAX,
                                        AttributeKey::VIS_SCALE_DOMAIN_MID, AttributeKey::VIS_SCALE_RANGE,
                                        AttributeKey::VIS_SCALE_RANGE_MIN, AttributeKey::VIS_SCALE_RANGE_MAX,
                                        AttributeKey::VIS_SCALE_SCHEME, AttributeKey::VIS_SCALE_INTERPOLATE,
                                        AttributeKey::VIS_SCALE_NICE, AttributeKey::VIS_SCALE_ZERO,
                                        AttributeKey::VIS_SCALE_CLAMP, AttributeKey::VIS_SCALE_PADDING,
                                        AttributeKey::VIS_SCALE_PADDING_INNER, AttributeKey::VIS_SCALE_PADDING_OUTER,
                                        AttributeKey::VIS_SCALE_REVERSE, AttributeKey::VIS_SCALE_ROUND,
                                        AttributeKey::VIS_SCALE_EXPONENT, AttributeKey::VIS_SCALE_BINS,
                                        AttributeKey::VIS_SCALE_NAME>(node);

                if (type_node && type_node->node_type() == NodeType::ENUM_VIS_SCALE_TYPE) {
                    s.type = static_cast<buffers::parser::VisScaleType>(type_node->children_begin_or_value());
                }
                if (domain_node) s.domain_node_id = NodeId(state, domain_node);
                if (domain_min_node) s.domain_min_node_id = NodeId(state, domain_min_node);
                if (domain_max_node) s.domain_max_node_id = NodeId(state, domain_max_node);
                if (domain_mid_node) s.domain_mid_node_id = NodeId(state, domain_mid_node);
                if (range_node) s.range_node_id = NodeId(state, range_node);
                if (range_min_node) s.range_min_node_id = NodeId(state, range_min_node);
                if (range_max_node) s.range_max_node_id = NodeId(state, range_max_node);
                if (scheme_node) s.scheme = ReadTextValue(state, scheme_node);
                if (interpolate_node) s.interpolate = ReadTextValue(state, interpolate_node);
                if (nice_node) s.nice = ReadBoolValue(state, nice_node);
                if (zero_node) s.zero = ReadBoolValue(state, zero_node);
                if (clamp_node) s.clamp = ReadBoolValue(state, clamp_node);
                if (padding_node) s.padding = ReadNumericValue(state, padding_node);
                if (padding_inner_node) s.padding_inner = ReadNumericValue(state, padding_inner_node);
                if (padding_outer_node) s.padding_outer = ReadNumericValue(state, padding_outer_node);
                if (reverse_node) s.reverse = ReadBoolValue(state, reverse_node);
                if (round_node) s.round = ReadBoolValue(state, round_node);
                if (exponent_node) s.exponent = ReadNumericValue(state, exponent_node);
                if (bins_node) s.bins_node_id = NodeId(state, bins_node);
                if (name_node) s.name = ReadTextValue(state, name_node);

                node_state.scale = std::move(s);
                break;
            }

            case NodeType::OBJECT_VIS_AXIS: {
                VisAxis a;
                a.ast_node_id = node_id;

                auto [orient_node, format_node, format_type_node, grid_node, ticks_node, tick_count_node,
                      tick_size_node, label_angle_node, label_font_size_node, label_overlap_node, direction_node,
                      offset_node, values_node, zindex_node, title_node, domain_node, name_node] =
                    state.GetAttributes<
                        AttributeKey::VIS_AXIS_ORIENT, AttributeKey::VIS_AXIS_FORMAT,
                        AttributeKey::VIS_AXIS_FORMAT_TYPE, AttributeKey::VIS_AXIS_GRID, AttributeKey::VIS_AXIS_TICKS,
                        AttributeKey::VIS_AXIS_TICK_COUNT, AttributeKey::VIS_AXIS_TICK_SIZE,
                        AttributeKey::VIS_AXIS_LABEL_ANGLE, AttributeKey::VIS_AXIS_LABEL_FONT_SIZE,
                        AttributeKey::VIS_AXIS_LABEL_OVERLAP, AttributeKey::VIS_AXIS_DIRECTION,
                        AttributeKey::VIS_AXIS_OFFSET, AttributeKey::VIS_AXIS_VALUES, AttributeKey::VIS_AXIS_ZINDEX,
                        AttributeKey::VIS_AXIS_TITLE, AttributeKey::VIS_AXIS_DOMAIN, AttributeKey::VIS_AXIS_NAME>(node);

                if (orient_node) a.orient = ReadTextValue(state, orient_node);
                if (format_node) a.format = ReadTextValue(state, format_node);
                if (format_type_node) a.format_type = ReadTextValue(state, format_type_node);
                if (grid_node) a.grid = ReadBoolValue(state, grid_node);
                if (ticks_node) a.ticks = ReadBoolValue(state, ticks_node);
                if (tick_count_node) a.tick_count = ReadNumericValue(state, tick_count_node);
                if (tick_size_node) a.tick_size = ReadNumericValue(state, tick_size_node);
                if (label_angle_node) a.label_angle = ReadNumericValue(state, label_angle_node);
                if (label_font_size_node) a.label_font_size = ReadNumericValue(state, label_font_size_node);
                if (label_overlap_node) a.label_overlap = ReadTextValue(state, label_overlap_node);
                if (direction_node) a.direction = ReadTextValue(state, direction_node);
                if (offset_node) a.offset = ReadNumericValue(state, offset_node);
                if (values_node) a.values_node_id = NodeId(state, values_node);
                if (zindex_node) {
                    auto v = ReadNumericValue(state, zindex_node);
                    if (v) a.zindex = static_cast<int32_t>(*v);
                }
                if (title_node) a.title = ReadTextValue(state, title_node);
                if (domain_node) a.domain = ReadBoolValue(state, domain_node);
                if (name_node) a.name = ReadTextValue(state, name_node);

                node_state.axis = std::move(a);
                break;
            }

            case NodeType::OBJECT_VIS_LEGEND: {
                VisLegend l;
                l.ast_node_id = node_id;

                auto [type_node, orient_node, format_node, format_type_node, direction_node, title_node, values_node,
                      padding_node, offset_node, zindex_node, name_node] =
                    state.GetAttributes<AttributeKey::VIS_LEGEND_TYPE, AttributeKey::VIS_LEGEND_ORIENT,
                                        AttributeKey::VIS_LEGEND_FORMAT, AttributeKey::VIS_LEGEND_FORMAT_TYPE,
                                        AttributeKey::VIS_LEGEND_DIRECTION, AttributeKey::VIS_LEGEND_TITLE,
                                        AttributeKey::VIS_LEGEND_VALUES, AttributeKey::VIS_LEGEND_PADDING,
                                        AttributeKey::VIS_LEGEND_OFFSET, AttributeKey::VIS_LEGEND_ZINDEX,
                                        AttributeKey::VIS_LEGEND_NAME>(node);

                if (type_node) l.type = ReadTextValue(state, type_node);
                if (orient_node) l.orient = ReadTextValue(state, orient_node);
                if (format_node) l.format = ReadTextValue(state, format_node);
                if (format_type_node) l.format_type = ReadTextValue(state, format_type_node);
                if (direction_node) l.direction = ReadTextValue(state, direction_node);
                if (title_node) l.title = ReadTextValue(state, title_node);
                if (values_node) l.values_node_id = NodeId(state, values_node);
                if (padding_node) l.padding = ReadNumericValue(state, padding_node);
                if (offset_node) l.offset = ReadNumericValue(state, offset_node);
                if (zindex_node) {
                    auto v = ReadNumericValue(state, zindex_node);
                    if (v) l.zindex = static_cast<int32_t>(*v);
                }
                if (name_node) l.name = ReadTextValue(state, name_node);

                node_state.legend = std::move(l);
                break;
            }

            case NodeType::OBJECT_VIS_FIELD_DEF: {
                MergeChildStates(node_state, node);

                VisEncodingChannel channel;
                channel.ast_node_id = node_id;
                channel.channel_key = node.attribute_key();
                channel.scale = std::move(node_state.scale);
                channel.axis = std::move(node_state.axis);
                channel.legend = std::move(node_state.legend);

                auto [field_node, type_node, bin_node, aggregate_node, time_unit_node] =
                    state.GetAttributes<AttributeKey::VIS_FIELD_DEF_FIELD, AttributeKey::VIS_FIELD_DEF_TYPE,
                                        AttributeKey::VIS_FIELD_DEF_BIN, AttributeKey::VIS_FIELD_DEF_AGGREGATE,
                                        AttributeKey::VIS_FIELD_DEF_TIME_UNIT>(node);

                if (field_node) {
                    auto* expr = state.GetDerivedForNode<AnalyzedScript::Expression>(*field_node);
                    if (expr) {
                        channel.field_expression_id = expr->expression_id;
                    }
                }

                if (type_node && type_node->node_type() == NodeType::ENUM_VIS_FIELD_TYPE) {
                    channel.field_type =
                        static_cast<buffers::parser::VisFieldType>(type_node->children_begin_or_value());
                }

                if (bin_node) {
                    VisBin b;
                    b.ast_node_id = NodeId(state, bin_node);
                    channel.bin = std::move(b);
                }

                if (aggregate_node) {
                    channel.aggregate = ReadTextValue(state, aggregate_node);
                }

                if (time_unit_node) {
                    channel.time_unit = ReadTextValue(state, time_unit_node);
                }

                // Reset consumed state
                node_state.scale.reset();
                node_state.axis.reset();
                node_state.legend.reset();
                node_state.encoding_channels.push_back(std::move(channel));
                break;
            }

            case NodeType::OBJECT_VIS_ENCODING: {
                MergeChildStates(node_state, node);

                // Check for shorthand encoding values (direct column refs as children)
                auto children = state.ast.subspan(node.children_begin_or_value(), node.children_count());
                for (auto& child : children) {
                    if (child.attribute_key() == AttributeKey::NONE) continue;
                    if (child.attribute_key() < AttributeKey::VIS_ENCODING_X) continue;
                    if (child.attribute_key() > AttributeKey::VIS_ENCODING_Y_OFFSET) continue;

                    if (child.node_type() == NodeType::OBJECT_SQL_COLUMN_REF) {
                        VisEncodingChannel channel;
                        channel.ast_node_id = &child - state.ast.data();
                        channel.channel_key = child.attribute_key();
                        auto* expr = state.GetDerivedForNode<AnalyzedScript::Expression>(child);
                        if (expr) {
                            channel.field_expression_id = expr->expression_id;
                        }
                        node_state.encoding_channels.push_back(std::move(channel));
                    }
                }
                break;
            }

            case NodeType::OBJECT_VIS_SPEC: {
                MergeChildStates(node_state, node);

                auto [mark_node, title_node, width_node, height_node] =
                    state.GetAttributes<AttributeKey::VIS_SPEC_MARK, AttributeKey::VIS_SPEC_TITLE,
                                        AttributeKey::VIS_SPEC_WIDTH, AttributeKey::VIS_SPEC_HEIGHT>(node);
                if (mark_node && mark_node->node_type() == NodeType::ENUM_VIS_MARK_TYPE) {
                    node_state.mark_type =
                        static_cast<buffers::parser::VisMarkType>(mark_node->children_begin_or_value());
                } else if (mark_node && mark_node->node_type() == NodeType::OBJECT_VIS_MARK) {
                    VisMark m = ExtractVisMark(state, *mark_node);
                    // Mirror the resolved type into mark_type so existing consumers
                    // (analyzer snapshot dump, callers reading the bare type) keep working.
                    node_state.mark_type = m.type;
                    node_state.mark = std::move(m);
                }
                if (title_node) {
                    node_state.title = ReadTextValue(state, title_node);
                }
                if (width_node) {
                    auto v = ReadNumericValue(state, width_node);
                    if (v) node_state.width = static_cast<int64_t>(*v);
                }
                if (height_node) {
                    auto v = ReadNumericValue(state, height_node);
                    if (v) node_state.height = static_cast<int64_t>(*v);
                }
                break;
            }

            case NodeType::OBJECT_VIS_VISUALISE: {
                MergeChildStates(node_state, node);

                auto [select_node, spec_node] =
                    state.GetAttributes<AttributeKey::VIS_VISUALISE_SELECT, AttributeKey::VIS_VISUALISE_SPEC>(node);

                VisualizationSpec spec;
                spec.ast_node_id = node_id;
                spec.mark_type = node_state.mark_type;
                spec.mark = std::move(node_state.mark);
                spec.title = node_state.title;
                spec.width = node_state.width;
                spec.height = node_state.height;
                spec.encoding_channels = std::move(node_state.encoding_channels);

                if (select_node) {
                    spec.source_node_id = select_node - state.ast.data();
                }

                collected_specs.push_back(std::move(spec));
                break;
            }

            default:
                MergeChildStates(node_state, node);
                break;
        }
    }
}

void AnalyzeVisualizationPass::Finish() {
    if (!state.parsed.statements.empty()) {
        for (auto& spec : collected_specs) {
            for (size_t stmt_id = 0; stmt_id < state.parsed.statements.size(); ++stmt_id) {
                auto& stmt = state.parsed.statements[stmt_id];
                if (spec.ast_node_id >= stmt.nodes_begin && spec.ast_node_id < stmt.nodes_begin + stmt.node_count) {
                    spec.ast_statement_id = stmt_id;
                    break;
                }
            }
        }
    }

    // Build an index from ast_node_id -> table reference, so the visualize source can be
    // resolved against the references already classified by NameResolutionPass.
    std::unordered_map<uint32_t, std::reference_wrapper<const AnalyzedScript::TableReference>>
        table_refs_by_ast_node;
    state.analyzed->table_references.ForEach([&](size_t, const AnalyzedScript::TableReference& ref) {
        table_refs_by_ast_node.emplace(ref.ast_node_id, std::cref(ref));
    });

    for (auto& spec : collected_specs) {
        if (!spec.source_node_id.has_value()) continue;
        auto source_node_id = *spec.source_node_id;
        const auto& source_node = state.ast[source_node_id];
        switch (source_node.node_type()) {
            case buffers::parser::NodeType::OBJECT_SQL_SELECT: {
                spec.resolved_source.kind = VisSourceKind::InlineSelect;
                spec.resolved_source.inline_select_ast_node_id = source_node_id;
                break;
            }
            case buffers::parser::NodeType::OBJECT_SQL_TABLEREF: {
                auto it = table_refs_by_ast_node.find(source_node_id);
                if (it == table_refs_by_ast_node.end()) break;
                auto* rel =
                    std::get_if<AnalyzedScript::TableReference::RelationExpression>(&it->second.get().inner);
                if (!rel) break;
                spec.resolved_source.qualified_name = rel->table_name;
                bool is_script_ref = rel->table_name.database_name.get().text == "dashql" &&
                                     rel->table_name.schema_name.get().text == "notebook";
                spec.resolved_source.kind =
                    is_script_ref ? VisSourceKind::ScriptReference : VisSourceKind::TableReference;
                break;
            }
            default:
                break;
        }
    }

    for (auto& spec : collected_specs) {
        state.analyzed->visualization_specs.PushBack(std::move(spec));
    }
}

}  // namespace dashql
