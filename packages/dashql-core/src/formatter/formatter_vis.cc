#include "dashql/formatter/formatter.h"

#include "dashql/formatter/formatting_program.h"

namespace dashql {

using AttributeKey = buffers::parser::AttributeKey;
using NodeType = buffers::parser::NodeType;
using VisMarkType = buffers::parser::VisMarkType;
using VisFieldType = buffers::parser::VisFieldType;
using VisScaleType = buffers::parser::VisScaleType;

namespace {

std::string_view GetVisAttributeKeyText(AttributeKey key) {
    switch (key) {
        case AttributeKey::VIS_SPEC_MARK: return "mark";
        case AttributeKey::VIS_SPEC_ENCODING: return "encoding";
        case AttributeKey::VIS_SPEC_LAYER: return "layer";
        case AttributeKey::VIS_SPEC_DATA: return "data";
        case AttributeKey::VIS_SPEC_TRANSFORM: return "transform";
        case AttributeKey::VIS_SPEC_PARAMS: return "params";
        case AttributeKey::VIS_SPEC_PROJECTION: return "projection";
        case AttributeKey::VIS_SPEC_AUTOSIZE: return "autosize";
        case AttributeKey::VIS_SPEC_RESOLVE: return "resolve";
        case AttributeKey::VIS_SPEC_DATASETS: return "datasets";
        case AttributeKey::VIS_SPEC_VIEW: return "view";
        case AttributeKey::VIS_SPEC_NAME: return "name";
        case AttributeKey::VIS_SPEC_TITLE: return "title";
        case AttributeKey::VIS_SPEC_WIDTH: return "width";
        case AttributeKey::VIS_SPEC_HEIGHT: return "height";
        case AttributeKey::VIS_SPEC_PADDING: return "padding";
        case AttributeKey::VIS_SPEC_BACKGROUND: return "background";
        case AttributeKey::VIS_SPEC_FILTER: return "filter";
        case AttributeKey::VIS_SPEC_DESCRIPTION: return "describe";
        case AttributeKey::VIS_SPEC_TYPE: return "type";
        case AttributeKey::VIS_ENCODING_X: return "x";
        case AttributeKey::VIS_ENCODING_Y: return "y";
        case AttributeKey::VIS_ENCODING_X2: return "x2";
        case AttributeKey::VIS_ENCODING_Y2: return "y2";
        case AttributeKey::VIS_ENCODING_COLOR: return "color";
        case AttributeKey::VIS_ENCODING_FILL: return "fill";
        case AttributeKey::VIS_ENCODING_STROKE: return "stroke";
        case AttributeKey::VIS_ENCODING_FILL_OPACITY: return "fill_opacity";
        case AttributeKey::VIS_ENCODING_STROKE_OPACITY: return "stroke_opacity";
        case AttributeKey::VIS_ENCODING_STROKE_WIDTH: return "stroke_width";
        case AttributeKey::VIS_ENCODING_STROKE_DASH: return "stroke_dash";
        case AttributeKey::VIS_ENCODING_OPACITY: return "opacity";
        case AttributeKey::VIS_ENCODING_SIZE: return "size";
        case AttributeKey::VIS_ENCODING_SHAPE: return "shape";
        case AttributeKey::VIS_ENCODING_ANGLE: return "angle";
        case AttributeKey::VIS_ENCODING_THETA: return "theta";
        case AttributeKey::VIS_ENCODING_THETA2: return "theta2";
        case AttributeKey::VIS_ENCODING_RADIUS: return "radius";
        case AttributeKey::VIS_ENCODING_RADIUS2: return "radius2";
        case AttributeKey::VIS_ENCODING_DETAIL: return "detail";
        case AttributeKey::VIS_ENCODING_ORDER: return "order";
        case AttributeKey::VIS_ENCODING_TOOLTIP: return "tooltip";
        case AttributeKey::VIS_ENCODING_TEXT: return "text";
        case AttributeKey::VIS_ENCODING_ROW: return "row";
        case AttributeKey::VIS_ENCODING_COLUMN: return "column";
        case AttributeKey::VIS_ENCODING_FACET: return "facet";
        case AttributeKey::VIS_ENCODING_HREF: return "href";
        case AttributeKey::VIS_ENCODING_URL: return "url";
        case AttributeKey::VIS_ENCODING_KEY: return "key";
        case AttributeKey::VIS_ENCODING_LATITUDE: return "latitude";
        case AttributeKey::VIS_ENCODING_LONGITUDE: return "longitude";
        case AttributeKey::VIS_ENCODING_LATITUDE2: return "latitude2";
        case AttributeKey::VIS_ENCODING_LONGITUDE2: return "longitude2";
        case AttributeKey::VIS_ENCODING_X_OFFSET: return "x_offset";
        case AttributeKey::VIS_ENCODING_Y_OFFSET: return "y_offset";
        case AttributeKey::VIS_FIELD_DEF_FIELD: return "field";
        case AttributeKey::VIS_FIELD_DEF_TYPE: return "type";
        case AttributeKey::VIS_FIELD_DEF_BIN: return "bin";
        case AttributeKey::VIS_FIELD_DEF_AGGREGATE: return "aggregate";
        case AttributeKey::VIS_FIELD_DEF_TIME_UNIT: return "time_unit";
        case AttributeKey::VIS_FIELD_DEF_SCALE: return "scale";
        case AttributeKey::VIS_FIELD_DEF_AXIS: return "axis";
        case AttributeKey::VIS_FIELD_DEF_LEGEND: return "legend";
        case AttributeKey::VIS_FIELD_DEF_SORT: return "sort";
        case AttributeKey::VIS_FIELD_DEF_STACK: return "stack";
        case AttributeKey::VIS_FIELD_DEF_IMPUTE: return "impute";
        case AttributeKey::VIS_FIELD_DEF_CONDITION: return "condition";
        case AttributeKey::VIS_FIELD_DEF_TITLE: return "title";
        case AttributeKey::VIS_FIELD_DEF_BAND_POSITION: return "band_position";
        case AttributeKey::VIS_FIELD_DEF_DATUM: return "datum";
        case AttributeKey::VIS_FIELD_DEF_VALUE: return "value";
        case AttributeKey::VIS_FIELD_DEF_FORMAT: return "format";
        case AttributeKey::VIS_FIELD_DEF_FORMAT_TYPE: return "format_type";
        case AttributeKey::VIS_SCALE_TYPE: return "type";
        case AttributeKey::VIS_SCALE_DOMAIN: return "domain";
        case AttributeKey::VIS_SCALE_DOMAIN_MIN: return "domain_min";
        case AttributeKey::VIS_SCALE_DOMAIN_MAX: return "domain_max";
        case AttributeKey::VIS_SCALE_DOMAIN_MID: return "domain_mid";
        case AttributeKey::VIS_SCALE_RANGE: return "range";
        case AttributeKey::VIS_SCALE_RANGE_MIN: return "range_min";
        case AttributeKey::VIS_SCALE_RANGE_MAX: return "range_max";
        case AttributeKey::VIS_SCALE_SCHEME: return "scheme";
        case AttributeKey::VIS_SCALE_INTERPOLATE: return "interpolate";
        case AttributeKey::VIS_SCALE_NICE: return "nice";
        case AttributeKey::VIS_SCALE_ZERO: return "zero";
        case AttributeKey::VIS_SCALE_CLAMP: return "clamp";
        case AttributeKey::VIS_SCALE_PADDING: return "padding";
        case AttributeKey::VIS_SCALE_PADDING_INNER: return "padding_inner";
        case AttributeKey::VIS_SCALE_PADDING_OUTER: return "padding_outer";
        case AttributeKey::VIS_SCALE_REVERSE: return "reverse";
        case AttributeKey::VIS_SCALE_ROUND: return "round";
        case AttributeKey::VIS_SCALE_EXPONENT: return "exponent";
        case AttributeKey::VIS_SCALE_BINS: return "bins";
        case AttributeKey::VIS_SCALE_NAME: return "name";
        case AttributeKey::VIS_AXIS_ORIENT: return "orient";
        case AttributeKey::VIS_AXIS_FORMAT: return "format";
        case AttributeKey::VIS_AXIS_FORMAT_TYPE: return "format_type";
        case AttributeKey::VIS_AXIS_GRID: return "grid";
        case AttributeKey::VIS_AXIS_TICKS: return "ticks";
        case AttributeKey::VIS_AXIS_TICK_COUNT: return "tick_count";
        case AttributeKey::VIS_AXIS_TICK_SIZE: return "tick_size";
        case AttributeKey::VIS_AXIS_LABEL_ANGLE: return "label_angle";
        case AttributeKey::VIS_AXIS_LABEL_FONT_SIZE: return "label_font_size";
        case AttributeKey::VIS_AXIS_LABEL_OVERLAP: return "label_overlap";
        case AttributeKey::VIS_AXIS_DIRECTION: return "direction";
        case AttributeKey::VIS_AXIS_OFFSET: return "offset";
        case AttributeKey::VIS_AXIS_VALUES: return "values";
        case AttributeKey::VIS_AXIS_ZINDEX: return "z_index";
        case AttributeKey::VIS_AXIS_TITLE: return "title";
        case AttributeKey::VIS_AXIS_DOMAIN: return "domain";
        case AttributeKey::VIS_AXIS_NAME: return "name";
        case AttributeKey::VIS_LEGEND_TYPE: return "type";
        case AttributeKey::VIS_LEGEND_ORIENT: return "orient";
        case AttributeKey::VIS_LEGEND_FORMAT: return "format";
        case AttributeKey::VIS_LEGEND_FORMAT_TYPE: return "format_type";
        case AttributeKey::VIS_LEGEND_DIRECTION: return "direction";
        case AttributeKey::VIS_LEGEND_TITLE: return "title";
        case AttributeKey::VIS_LEGEND_VALUES: return "values";
        case AttributeKey::VIS_LEGEND_PADDING: return "padding";
        case AttributeKey::VIS_LEGEND_OFFSET: return "offset";
        case AttributeKey::VIS_LEGEND_ZINDEX: return "z_index";
        case AttributeKey::VIS_LEGEND_NAME: return "name";
        default: return "";
    }
}

}  // namespace

FmtReg Formatter::FormatVisEnum(const buffers::parser::Node& node) {
    auto nt = node.node_type();
    auto value = static_cast<uint32_t>(node.children_begin_or_value());
    switch (nt) {
        case NodeType::ENUM_VIS_MARK_TYPE:
            switch (static_cast<VisMarkType>(value)) {
                case VisMarkType::ARC: return fmt.Text("arc");
                case VisMarkType::AREA: return fmt.Text("area");
                case VisMarkType::BAR: return fmt.Text("bar");
                case VisMarkType::BOXPLOT: return fmt.Text("boxplot");
                case VisMarkType::CIRCLE: return fmt.Text("circle");
                case VisMarkType::GEOSHAPE: return fmt.Text("geoshape");
                case VisMarkType::IMAGE: return fmt.Text("image");
                case VisMarkType::LINE: return fmt.Text("line");
                case VisMarkType::POINT: return fmt.Text("point");
                case VisMarkType::RECT: return fmt.Text("rect");
                case VisMarkType::RULE: return fmt.Text("rule");
                case VisMarkType::SQUARE: return fmt.Text("square");
                case VisMarkType::TEXT: return fmt.Text("text");
                case VisMarkType::TICK: return fmt.Text("tick");
                case VisMarkType::TRAIL: return fmt.Text("trail");
            }
            break;
        case NodeType::ENUM_VIS_FIELD_TYPE:
            switch (static_cast<VisFieldType>(value)) {
                case VisFieldType::NOMINAL: return fmt.Text("nominal");
                case VisFieldType::ORDINAL: return fmt.Text("ordinal");
                case VisFieldType::QUANTITATIVE: return fmt.Text("quantitative");
                case VisFieldType::TEMPORAL: return fmt.Text("temporal");
                case VisFieldType::GEOJSON: return fmt.Text("geojson");
            }
            break;
        case NodeType::ENUM_VIS_SCALE_TYPE:
            switch (static_cast<VisScaleType>(value)) {
                case VisScaleType::LINEAR: return fmt.Text("linear");
                case VisScaleType::LOG: return fmt.Text("log");
                case VisScaleType::POW: return fmt.Text("pow");
                case VisScaleType::SQRT: return fmt.Text("sqrt");
                case VisScaleType::SYMLOG: return fmt.Text("symlog");
                case VisScaleType::IDENTITY: return fmt.Text("identity");
                case VisScaleType::SEQUENTIAL: return fmt.Text("sequential");
                case VisScaleType::TIME: return fmt.Text("time");
                case VisScaleType::UTC: return fmt.Text("utc");
                case VisScaleType::QUANTILE: return fmt.Text("quantile");
                case VisScaleType::QUANTIZE: return fmt.Text("quantize");
                case VisScaleType::THRESHOLD: return fmt.Text("threshold");
                case VisScaleType::ORDINAL: return fmt.Text("ordinal");
                case VisScaleType::BAND: return fmt.Text("band");
                case VisScaleType::POINT: return fmt.Text("point");
                case VisScaleType::BIN_ORDINAL: return fmt.Text("bin_ordinal");
                case VisScaleType::DIVERGING: return fmt.Text("diverging");
            }
            break;
        default:
            break;
    }
    return FormatUnimplemented(node);
}

FmtReg Formatter::FormatVarargArray(const buffers::parser::Node& node) {
    auto [values] = GetAttributes<AttributeKey::EXT_VARARG_ARRAY_VALUES>(node);
    if (!values || values->node_type() != NodeType::ARRAY) {
        return FormatUnimplemented(node);
    }
    if (values->children_count() == 0) return fmt.Text("[]");

    std::vector<FmtReg> items;
    items.reserve(values->children_count());
    auto begin = values->children_begin_or_value();
    for (size_t i = 0; i < values->children_count(); ++i) {
        auto reg = Reg(ast[begin + i]);
        if (reg != 0) items.push_back(reg);
    }
    if (items.empty()) return fmt.Text("[]");

    auto inline_separator = fmt.Text(", ");
    auto break_separator = fmt.Concat({fmt.Text(","), fmt.Break()});
    auto list = fmt.Join(items, inline_separator, break_separator, FormattingJoinPolicy::BreakOnOverflow);
    return fmt.Concat({fmt.Text("["), list, fmt.Text("]")});
}

FmtReg Formatter::FormatVisPropertyList(const buffers::parser::Node& node) {
    auto children = ast.subspan(node.children_begin_or_value(), node.children_count());
    std::vector<FmtReg> parts;
    parts.reserve(children.size());

    for (const auto& child : children) {
        if (child.node_type() == NodeType::NONE) continue;
        auto key = child.attribute_key();
        auto key_text = GetVisAttributeKeyText(key);
        if (key_text.empty()) continue;

        auto value_reg = Reg(child);
        if (value_reg == 0) continue;

        auto pair = fmt.Concat({fmt.Text(key_text), fmt.Text(" => "), value_reg});
        parts.push_back(pair);
    }

    if (parts.empty()) return fmt.Empty();

    bool eager_break = config.mode == buffers::formatting::FormattingMode::PRETTY;
    bool inline_mode = config.mode == buffers::formatting::FormattingMode::INLINE;
    bool is_top_level_spec = node.node_type() == NodeType::OBJECT_VIS_SPEC;
    auto inline_separator = fmt.Text(", ");
    auto break_separator = fmt.Concat({fmt.Text(","), fmt.Break()});
    if (eager_break) {
        auto join = fmt.Join(parts, inline_separator, break_separator, FormattingJoinPolicy::ForceBreak);
        return fmt.Concat({fmt.Text("("), fmt.Indented(fmt.Concat({fmt.Break(), join})), fmt.Break(), fmt.Text(")")});
    }
    auto join = fmt.Join(parts, inline_separator, break_separator);
    if (is_top_level_spec && !inline_mode) {
        return fmt.Concat({fmt.Text("("), fmt.Indented(fmt.Concat({fmt.Break(), join})), fmt.Break(), fmt.Text(")")});
    }
    return fmt.Parenthesized(join);
}

FmtReg Formatter::FormatVisualize(size_t node_id) {
    const auto& node = ast[node_id];
    auto [source, spec] =
        GetAttributes<AttributeKey::VIS_VISUALISE_SELECT, AttributeKey::VIS_VISUALISE_SPEC>(node);

    if (!spec) return FormatUnimplemented(node);

    auto spec_reg = Reg(*spec);
    if (spec_reg == 0) return FormatUnimplemented(node);

    std::vector<FmtReg> header_parts;
    header_parts.reserve(4);
    header_parts.push_back(fmt.Text("visualize "));

    if (source && source->node_type() != NodeType::NONE) {
        auto source_reg = Reg(*source);
        if (source_reg != 0) {
            if (source->node_type() == NodeType::OBJECT_SQL_SELECT) {
                header_parts.push_back(fmt.Parenthesized(source_reg));
            } else {
                header_parts.push_back(source_reg);
            }
            header_parts.push_back(fmt.Text(" "));
        }
    }

    header_parts.push_back(fmt.Text("as "));
    auto header = fmt.Concat(std::move(header_parts));
    return fmt.Concat({header, spec_reg});
}

}  // namespace dashql
