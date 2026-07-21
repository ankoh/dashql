#include "dashql/visualize/vegalite.h"

#include <algorithm>
#include <cctype>
#include <string>
#include <string_view>
#include <unordered_map>

#include "dashql/buffers/index_generated.h"
#include "dashql/script.h"
#include "rapidjson/prettywriter.h"
#include "rapidjson/stringbuffer.h"

namespace dashql::visualize {

namespace {

static const std::unordered_map<buffers::parser::AttributeKey, std::string_view> CHANNEL_KEY_TO_VEGALITE = {
    {buffers::parser::AttributeKey::VIS_ENCODING_X, "x"},
    {buffers::parser::AttributeKey::VIS_ENCODING_Y, "y"},
    {buffers::parser::AttributeKey::VIS_ENCODING_X2, "x2"},
    {buffers::parser::AttributeKey::VIS_ENCODING_Y2, "y2"},
    {buffers::parser::AttributeKey::VIS_ENCODING_COLOR, "color"},
    {buffers::parser::AttributeKey::VIS_ENCODING_FILL, "fill"},
    {buffers::parser::AttributeKey::VIS_ENCODING_STROKE, "stroke"},
    {buffers::parser::AttributeKey::VIS_ENCODING_FILL_OPACITY, "fillOpacity"},
    {buffers::parser::AttributeKey::VIS_ENCODING_STROKE_OPACITY, "strokeOpacity"},
    {buffers::parser::AttributeKey::VIS_ENCODING_STROKE_WIDTH, "strokeWidth"},
    {buffers::parser::AttributeKey::VIS_ENCODING_STROKE_DASH, "strokeDash"},
    {buffers::parser::AttributeKey::VIS_ENCODING_OPACITY, "opacity"},
    {buffers::parser::AttributeKey::VIS_ENCODING_SIZE, "size"},
    {buffers::parser::AttributeKey::VIS_ENCODING_SHAPE, "shape"},
    {buffers::parser::AttributeKey::VIS_ENCODING_ANGLE, "angle"},
    {buffers::parser::AttributeKey::VIS_ENCODING_THETA, "theta"},
    {buffers::parser::AttributeKey::VIS_ENCODING_THETA2, "theta2"},
    {buffers::parser::AttributeKey::VIS_ENCODING_RADIUS, "radius"},
    {buffers::parser::AttributeKey::VIS_ENCODING_RADIUS2, "radius2"},
    {buffers::parser::AttributeKey::VIS_ENCODING_DETAIL, "detail"},
    {buffers::parser::AttributeKey::VIS_ENCODING_ORDER, "order"},
    {buffers::parser::AttributeKey::VIS_ENCODING_TOOLTIP, "tooltip"},
    {buffers::parser::AttributeKey::VIS_ENCODING_TEXT, "text"},
    {buffers::parser::AttributeKey::VIS_ENCODING_ROW, "row"},
    {buffers::parser::AttributeKey::VIS_ENCODING_COLUMN, "column"},
    {buffers::parser::AttributeKey::VIS_ENCODING_FACET, "facet"},
    {buffers::parser::AttributeKey::VIS_ENCODING_HREF, "href"},
    {buffers::parser::AttributeKey::VIS_ENCODING_URL, "url"},
    {buffers::parser::AttributeKey::VIS_ENCODING_KEY, "key"},
    {buffers::parser::AttributeKey::VIS_ENCODING_LATITUDE, "latitude"},
    {buffers::parser::AttributeKey::VIS_ENCODING_LONGITUDE, "longitude"},
    {buffers::parser::AttributeKey::VIS_ENCODING_LATITUDE2, "latitude2"},
    {buffers::parser::AttributeKey::VIS_ENCODING_LONGITUDE2, "longitude2"},
    {buffers::parser::AttributeKey::VIS_ENCODING_X_OFFSET, "xOffset"},
    {buffers::parser::AttributeKey::VIS_ENCODING_Y_OFFSET, "yOffset"},
};

std::string ToLower(std::string_view s) {
    std::string result(s);
    std::transform(result.begin(), result.end(), result.begin(), [](unsigned char c) { return std::tolower(c); });
    return result;
}

std::string ResolveFieldName(const AnalyzedScript& script, uint32_t expression_id) {
    auto& expr = script.expressions[expression_id];
    if (auto* col_ref = std::get_if<AnalyzedScript::Expression::ColumnRef>(&expr.inner)) {
        return std::string(col_ref->column_name.column_name.get().text);
    }
    auto span = script.parsed_script->scanned_script->ResolveTextSpan(
        script.parsed_script->nodes[expr.ast_node_id].symbol_span());
    auto input = script.parsed_script->scanned_script->GetInput();
    return std::string(input.substr(span.offset(), span.length()));
}

template <typename W>
void WriteArrayNode(W& writer, uint32_t node_id, const AnalyzedScript& script) {
    auto& node = script.parsed_script->nodes[node_id];
    // node is OBJECT_EXT_VARARG_ARRAY; find ARRAY child with key EXT_VARARG_ARRAY_VALUES
    const buffers::parser::Node* array_node = nullptr;
    for (size_t i = 0; i < node.children_count(); ++i) {
        auto& child = script.parsed_script->nodes[node.children_begin_or_value() + i];
        if (child.attribute_key() == buffers::parser::AttributeKey::EXT_VARARG_ARRAY_VALUES) {
            array_node = &child;
            break;
        }
    }
    if (!array_node) {
        writer.StartArray();
        writer.EndArray();
        return;
    }
    writer.StartArray();
    auto input = script.parsed_script->scanned_script->GetInput();
    for (size_t i = 0; i < array_node->children_count(); ++i) {
        auto& elem = script.parsed_script->nodes[array_node->children_begin_or_value() + i];
        auto span = script.parsed_script->scanned_script->ResolveTextSpan(elem.symbol_span());
        std::string text(input.substr(span.offset(), span.length()));
        if (elem.node_type() == buffers::parser::NodeType::LITERAL_INTEGER ||
            elem.node_type() == buffers::parser::NodeType::LITERAL_FLOAT ||
            elem.node_type() == buffers::parser::NodeType::OBJECT_SQL_NARY_EXPRESSION) {
            char* end = nullptr;
            double val = std::strtod(text.c_str(), &end);
            if (end && *end == '\0') {
                if (elem.node_type() == buffers::parser::NodeType::LITERAL_INTEGER && val == static_cast<int64_t>(val)) {
                    writer.Int64(static_cast<int64_t>(val));
                } else {
                    writer.Double(val);
                }
            } else {
                writer.String(text.c_str());
            }
        } else if (elem.node_type() == buffers::parser::NodeType::LITERAL_STRING) {
            if (text.size() >= 2 && text.front() == '\'' && text.back() == '\'') {
                text = text.substr(1, text.size() - 2);
            }
            writer.String(text.c_str());
        } else {
            writer.String(text.c_str());
        }
    }
    writer.EndArray();
}

template <typename W>
void WriteScale(W& writer, const VisScale& s, const AnalyzedScript& script) {
    writer.StartObject();
    if (s.type.has_value()) {
        auto* tt = buffers::parser::VisScaleTypeTypeTable();
        writer.Key("type");
        writer.String(ToLower(tt->names[static_cast<uint8_t>(*s.type)]).c_str());
    }
    if (s.zero.has_value()) {
        writer.Key("zero");
        writer.Bool(*s.zero);
    }
    if (s.nice.has_value()) {
        writer.Key("nice");
        writer.Bool(*s.nice);
    }
    if (s.clamp.has_value()) {
        writer.Key("clamp");
        writer.Bool(*s.clamp);
    }
    if (s.reverse.has_value()) {
        writer.Key("reverse");
        writer.Bool(*s.reverse);
    }
    if (s.round.has_value()) {
        writer.Key("round");
        writer.Bool(*s.round);
    }
    if (s.scheme.has_value()) {
        writer.Key("scheme");
        writer.String(s.scheme->data(), s.scheme->size());
    }
    if (s.interpolate.has_value()) {
        writer.Key("interpolate");
        writer.String(s.interpolate->data(), s.interpolate->size());
    }
    if (s.exponent.has_value()) {
        writer.Key("exponent");
        writer.Double(*s.exponent);
    }
    if (s.base.has_value()) {
        writer.Key("base");
        writer.Double(*s.base);
    }
    if (s.constant.has_value()) {
        writer.Key("constant");
        writer.Double(*s.constant);
    }
    if (s.padding.has_value()) {
        writer.Key("padding");
        writer.Double(*s.padding);
    }
    if (s.padding_inner.has_value()) {
        writer.Key("paddingInner");
        writer.Double(*s.padding_inner);
    }
    if (s.padding_outer.has_value()) {
        writer.Key("paddingOuter");
        writer.Double(*s.padding_outer);
    }
    if (s.align.has_value()) {
        writer.Key("align");
        writer.Double(*s.align);
    }
    if (s.domain_node_id.has_value()) {
        writer.Key("domain");
        WriteArrayNode(writer, *s.domain_node_id, script);
    }
    if (s.domain_min_node_id.has_value()) {
        writer.Key("domainMin");
        auto& node = script.parsed_script->nodes[*s.domain_min_node_id];
        auto span = script.parsed_script->scanned_script->ResolveTextSpan(node.symbol_span());
        auto input = script.parsed_script->scanned_script->GetInput();
        std::string text(input.substr(span.offset(), span.length()));
        char* end = nullptr;
        double val = std::strtod(text.c_str(), &end);
        if (end && *end == '\0') writer.Double(val);
        else writer.String(text.c_str());
    }
    if (s.domain_max_node_id.has_value()) {
        writer.Key("domainMax");
        auto& node = script.parsed_script->nodes[*s.domain_max_node_id];
        auto span = script.parsed_script->scanned_script->ResolveTextSpan(node.symbol_span());
        auto input = script.parsed_script->scanned_script->GetInput();
        std::string text(input.substr(span.offset(), span.length()));
        char* end = nullptr;
        double val = std::strtod(text.c_str(), &end);
        if (end && *end == '\0') writer.Double(val);
        else writer.String(text.c_str());
    }
    if (s.domain_mid_node_id.has_value()) {
        writer.Key("domainMid");
        auto& node = script.parsed_script->nodes[*s.domain_mid_node_id];
        auto span = script.parsed_script->scanned_script->ResolveTextSpan(node.symbol_span());
        auto input = script.parsed_script->scanned_script->GetInput();
        std::string text(input.substr(span.offset(), span.length()));
        char* end = nullptr;
        double val = std::strtod(text.c_str(), &end);
        if (end && *end == '\0') writer.Double(val);
        else writer.String(text.c_str());
    }
    if (s.range_node_id.has_value()) {
        writer.Key("range");
        WriteArrayNode(writer, *s.range_node_id, script);
    }
    if (s.range_min_node_id.has_value()) {
        writer.Key("rangeMin");
        auto& node = script.parsed_script->nodes[*s.range_min_node_id];
        auto span = script.parsed_script->scanned_script->ResolveTextSpan(node.symbol_span());
        auto input = script.parsed_script->scanned_script->GetInput();
        std::string text(input.substr(span.offset(), span.length()));
        char* end = nullptr;
        double val = std::strtod(text.c_str(), &end);
        if (end && *end == '\0') writer.Double(val);
        else writer.String(text.c_str());
    }
    if (s.range_max_node_id.has_value()) {
        writer.Key("rangeMax");
        auto& node = script.parsed_script->nodes[*s.range_max_node_id];
        auto span = script.parsed_script->scanned_script->ResolveTextSpan(node.symbol_span());
        auto input = script.parsed_script->scanned_script->GetInput();
        std::string text(input.substr(span.offset(), span.length()));
        char* end = nullptr;
        double val = std::strtod(text.c_str(), &end);
        if (end && *end == '\0') writer.Double(val);
        else writer.String(text.c_str());
    }
    if (s.name.has_value()) {
        writer.Key("name");
        writer.String(s.name->data(), s.name->size());
    }
    writer.EndObject();
}

template <typename W>
void WriteAxis(W& writer, const VisAxis& a) {
    writer.StartObject();
    if (a.orient.has_value()) {
        writer.Key("orient");
        writer.String(a.orient->data(), a.orient->size());
    }
    if (a.title.has_value()) {
        writer.Key("title");
        writer.String(a.title->data(), a.title->size());
    }
    if (a.format.has_value()) {
        writer.Key("format");
        writer.String(a.format->data(), a.format->size());
    }
    if (a.format_type.has_value()) {
        writer.Key("formatType");
        writer.String(a.format_type->data(), a.format_type->size());
    }
    if (a.grid.has_value()) {
        writer.Key("grid");
        writer.Bool(*a.grid);
    }
    if (a.ticks.has_value()) {
        writer.Key("ticks");
        writer.Bool(*a.ticks);
    }
    if (a.domain.has_value()) {
        writer.Key("domain");
        writer.Bool(*a.domain);
    }
    if (a.tick_count.has_value()) {
        writer.Key("tickCount");
        writer.Double(*a.tick_count);
    }
    if (a.tick_size.has_value()) {
        writer.Key("tickSize");
        writer.Double(*a.tick_size);
    }
    if (a.label_angle.has_value()) {
        writer.Key("labelAngle");
        writer.Double(*a.label_angle);
    }
    if (a.label_font_size.has_value()) {
        writer.Key("labelFontSize");
        writer.Double(*a.label_font_size);
    }
    if (a.label_overlap.has_value()) {
        writer.Key("labelOverlap");
        writer.String(a.label_overlap->data(), a.label_overlap->size());
    }
    if (a.direction.has_value()) {
        writer.Key("direction");
        writer.String(a.direction->data(), a.direction->size());
    }
    if (a.offset.has_value()) {
        writer.Key("offset");
        writer.Double(*a.offset);
    }
    if (a.zindex.has_value()) {
        writer.Key("zIndex");
        writer.Int(*a.zindex);
    }
    if (a.name.has_value()) {
        writer.Key("name");
        writer.String(a.name->data(), a.name->size());
    }
    writer.EndObject();
}

template <typename W>
void WriteLegend(W& writer, const VisLegend& l) {
    writer.StartObject();
    if (l.type.has_value()) {
        writer.Key("type");
        writer.String(l.type->data(), l.type->size());
    }
    if (l.orient.has_value()) {
        writer.Key("orient");
        writer.String(l.orient->data(), l.orient->size());
    }
    if (l.title.has_value()) {
        writer.Key("title");
        writer.String(l.title->data(), l.title->size());
    }
    if (l.format.has_value()) {
        writer.Key("format");
        writer.String(l.format->data(), l.format->size());
    }
    if (l.format_type.has_value()) {
        writer.Key("formatType");
        writer.String(l.format_type->data(), l.format_type->size());
    }
    if (l.direction.has_value()) {
        writer.Key("direction");
        writer.String(l.direction->data(), l.direction->size());
    }
    if (l.padding.has_value()) {
        writer.Key("padding");
        writer.Double(*l.padding);
    }
    if (l.offset.has_value()) {
        writer.Key("offset");
        writer.Double(*l.offset);
    }
    if (l.zindex.has_value()) {
        writer.Key("zIndex");
        writer.Int(*l.zindex);
    }
    if (l.name.has_value()) {
        writer.Key("name");
        writer.String(l.name->data(), l.name->size());
    }
    writer.EndObject();
}

/// Write a mark definition as a Vega-Lite mark object. `point` / `line` overlays
/// recurse: a boolean toggle writes a bool, a nested definition writes an object.
template <typename W>
void WriteMark(W& writer, const VisMark& m, const AnalyzedScript& script) {
    writer.StartObject();
    if (m.type.has_value()) {
        auto* tt = buffers::parser::VisMarkTypeTypeTable();
        writer.Key("type");
        writer.String(ToLower(tt->names[static_cast<uint8_t>(*m.type)]).c_str());
    }
    if (m.filled.has_value()) {
        writer.Key("filled");
        writer.Bool(*m.filled);
    }
    if (m.fill.has_value()) {
        writer.Key("fill");
        writer.String(m.fill->data(), m.fill->size());
    }
    if (m.stroke.has_value()) {
        writer.Key("stroke");
        writer.String(m.stroke->data(), m.stroke->size());
    }
    if (m.color.has_value()) {
        writer.Key("color");
        writer.String(m.color->data(), m.color->size());
    }
    if (m.opacity.has_value()) {
        writer.Key("opacity");
        writer.Double(*m.opacity);
    }
    if (m.fill_opacity.has_value()) {
        writer.Key("fillOpacity");
        writer.Double(*m.fill_opacity);
    }
    if (m.stroke_opacity.has_value()) {
        writer.Key("strokeOpacity");
        writer.Double(*m.stroke_opacity);
    }
    if (m.stroke_width.has_value()) {
        writer.Key("strokeWidth");
        writer.Double(*m.stroke_width);
    }
    if (m.stroke_dash_node_id.has_value()) {
        writer.Key("strokeDash");
        WriteArrayNode(writer, *m.stroke_dash_node_id, script);
    }
    if (m.size.has_value()) {
        writer.Key("size");
        writer.Double(*m.size);
    }
    if (m.shape.has_value()) {
        writer.Key("shape");
        writer.String(m.shape->data(), m.shape->size());
    }
    if (m.angle.has_value()) {
        writer.Key("angle");
        writer.Double(*m.angle);
    }
    if (m.radius.has_value()) {
        writer.Key("radius");
        writer.Double(*m.radius);
    }
    if (m.corner_radius.has_value()) {
        writer.Key("cornerRadius");
        writer.Double(*m.corner_radius);
    }
    if (m.orient.has_value()) {
        writer.Key("orient");
        writer.String(m.orient->data(), m.orient->size());
    }
    if (m.interpolate.has_value()) {
        writer.Key("interpolate");
        writer.String(m.interpolate->data(), m.interpolate->size());
    }
    if (m.tension.has_value()) {
        writer.Key("tension");
        writer.Double(*m.tension);
    }
    if (m.thickness.has_value()) {
        writer.Key("thickness");
        writer.Double(*m.thickness);
    }
    if (m.tooltip.has_value()) {
        writer.Key("tooltip");
        writer.Bool(*m.tooltip);
    }
    if (m.point) {
        writer.Key("point");
        WriteMark(writer, *m.point, script);
    } else if (m.point_enabled.has_value()) {
        writer.Key("point");
        writer.Bool(*m.point_enabled);
    }
    if (m.line) {
        writer.Key("line");
        WriteMark(writer, *m.line, script);
    } else if (m.line_enabled.has_value()) {
        writer.Key("line");
        writer.Bool(*m.line_enabled);
    }
    writer.EndObject();
}

template <typename W>
void WriteBin(W& writer, const VisBin& b) {
    bool has_params = b.step.has_value() || b.maxbins.has_value() || b.minstep.has_value() || b.anchor.has_value() ||
                      b.base.has_value() || b.nice.has_value() || b.binned.has_value();
    if (!has_params) {
        writer.Bool(true);
        return;
    }
    writer.StartObject();
    if (b.binned.has_value()) {
        writer.Key("binned");
        writer.Bool(*b.binned);
    }
    if (b.step.has_value()) {
        writer.Key("step");
        writer.Double(*b.step);
    }
    if (b.maxbins.has_value()) {
        writer.Key("maxbins");
        writer.Double(*b.maxbins);
    }
    if (b.minstep.has_value()) {
        writer.Key("minstep");
        writer.Double(*b.minstep);
    }
    if (b.anchor.has_value()) {
        writer.Key("anchor");
        writer.Double(*b.anchor);
    }
    if (b.base.has_value()) {
        writer.Key("base");
        writer.Double(*b.base);
    }
    if (b.nice.has_value()) {
        writer.Key("nice");
        writer.Bool(*b.nice);
    }
    writer.EndObject();
}

}  // namespace

std::string GenerateVegaLiteSpec(const VisualizationSpec& spec, const AnalyzedScript& script) {
    rapidjson::StringBuffer sb;
    rapidjson::PrettyWriter<rapidjson::StringBuffer> writer(sb);
    writer.SetIndent(' ', 2);

    writer.StartObject();

    writer.Key("$schema");
    writer.String("https://vega.github.io/schema/vega-lite/v5.json");

    if (spec.source_node_id.has_value()) {
        auto& source_node = script.parsed_script->nodes[*spec.source_node_id];
        auto span = script.parsed_script->scanned_script->ResolveTextSpan(source_node.symbol_span());
        auto input = script.parsed_script->scanned_script->GetInput();
        writer.Key("data");
        writer.StartObject();
        if (source_node.node_type() == buffers::parser::NodeType::OBJECT_SQL_SELECT) {
            // Strip the wrapping parentheses from the grammar rule: LRB sql_select_stmt RRB
            std::string source_text(input.substr(span.offset() + 1, span.length() - 2));
            writer.Key("$sql");
            writer.String(source_text.c_str());
        } else {
            std::string source_text(input.substr(span.offset(), span.length()));
            writer.Key("name");
            writer.String(source_text.c_str());
        }
        writer.EndObject();
    }

    if (spec.mark.has_value() && spec.mark->HasProperties()) {
        // Structured mark definition: `mark => (type => line, point => (...))`
        writer.Key("mark");
        WriteMark(writer, *spec.mark, script);
    } else if (spec.mark_type.has_value()) {
        // Bare mark type: `mark => bar` stays a plain string for compactness.
        auto* tt = buffers::parser::VisMarkTypeTypeTable();
        std::string mark = ToLower(tt->names[static_cast<uint8_t>(*spec.mark_type)]);
        writer.Key("mark");
        writer.String(mark.c_str());
    }

    if (spec.title.has_value()) {
        writer.Key("title");
        writer.String(spec.title->data(), spec.title->size());
    }
    if (spec.width.has_value()) {
        writer.Key("width");
        writer.Int64(*spec.width);
    }
    if (spec.height.has_value()) {
        writer.Key("height");
        writer.Int64(*spec.height);
    }

    if (!spec.encoding_channels.empty()) {
        writer.Key("encoding");
        writer.StartObject();
        auto* ft_tt = buffers::parser::VisFieldTypeTypeTable();
        for (auto& channel : spec.encoding_channels) {
            auto it = CHANNEL_KEY_TO_VEGALITE.find(channel.channel_key);
            if (it == CHANNEL_KEY_TO_VEGALITE.end()) continue;
            writer.Key(it->second.data(), it->second.size());
            writer.StartObject();

            if (channel.field_expression_id.has_value()) {
                std::string field_name = ResolveFieldName(script, *channel.field_expression_id);
                writer.Key("field");
                writer.String(field_name.c_str());
            }
            if (channel.field_type.has_value()) {
                writer.Key("type");
                writer.String(ToLower(ft_tt->names[static_cast<uint8_t>(*channel.field_type)]).c_str());
            }
            if (channel.aggregate.has_value()) {
                writer.Key("aggregate");
                writer.String(channel.aggregate->data(), channel.aggregate->size());
            }
            if (channel.bin.has_value()) {
                writer.Key("bin");
                WriteBin(writer, *channel.bin);
            }
            if (channel.time_unit.has_value()) {
                writer.Key("timeUnit");
                writer.String(channel.time_unit->data(), channel.time_unit->size());
            }
            if (channel.scale.has_value()) {
                writer.Key("scale");
                WriteScale(writer, *channel.scale, script);
            }
            if (channel.axis.has_value()) {
                writer.Key("axis");
                WriteAxis(writer, *channel.axis);
            }
            if (channel.legend.has_value()) {
                writer.Key("legend");
                WriteLegend(writer, *channel.legend);
            }

            writer.EndObject();
        }
        writer.EndObject();
    }

    writer.EndObject();
    return sb.GetString();
}

std::string GenerateUmapSpec(const VisualizationSpec& spec, const AnalyzedScript& script) {
    if (!spec.umap.has_value()) {
        return {};
    }
    const auto& um = *spec.umap;

    rapidjson::StringBuffer sb;
    rapidjson::PrettyWriter<rapidjson::StringBuffer> writer(sb);
    writer.SetIndent(' ', 2);

    writer.StartObject();

    if (um.vector_expression_id.has_value()) {
        std::string name = ResolveFieldName(script, *um.vector_expression_id);
        writer.Key("vectorColumn");
        writer.String(name.c_str());
    }
    if (um.category_expression_id.has_value()) {
        std::string name = ResolveFieldName(script, *um.category_expression_id);
        writer.Key("categoryColumn");
        writer.String(name.c_str());
    }
    if (um.label_expression_id.has_value()) {
        std::string name = ResolveFieldName(script, *um.label_expression_id);
        writer.Key("labelColumn");
        writer.String(name.c_str());
    }

    writer.Key("projection");
    writer.StartObject();
    const auto& proj = um.projection;
    // The umap renderer always projects with UMAP; record it explicitly so the runtime
    // has a self-describing projection spec.
    writer.Key("method");
    writer.String("umap");
    if (proj.metric.has_value()) {
        writer.Key("metric");
        writer.String(std::string(*proj.metric).c_str());
    }
    if (proj.neighbors.has_value()) {
        writer.Key("neighbors");
        writer.Int64(static_cast<int64_t>(*proj.neighbors));
    }
    if (proj.min_dist.has_value()) {
        writer.Key("minDist");
        writer.Double(*proj.min_dist);
    }
    writer.EndObject();

    writer.EndObject();
    return sb.GetString();
}

}  // namespace dashql::visualize
