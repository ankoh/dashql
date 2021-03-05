#include "dashql/analyzer/viz_statement.h"

#include <flatbuffers/flatbuffers.h>

#include <iostream>
#include <limits>
#include <stack>
#include <unordered_map>

#include "dashql/analyzer/program_editor.h"
#include "dashql/analyzer/program_instance.h"
#include "dashql/analyzer/program_linter.h"
#include "dashql/analyzer/syntax_matcher.h"
#include "dashql/common/expected.h"
#include "dashql/common/memstream.h"
#include "dashql/common/span.h"
#include "dashql/common/string.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/proto_generated.h"

namespace pv = dashql::proto::viz;
namespace fb = flatbuffers;

namespace dashql {
namespace viz {

class VizAttributePrinter {
   protected:
    /// The output
    std::ostream& out;
    /// Already started?
    bool started;
    /// Already finished?
    bool finished;

   public:
    ~VizAttributePrinter();

    /// Constructor
    VizAttributePrinter(std::ostream& out);
    /// Start a key
    void AddKey(std::string_view key);
    /// Start a value
    std::ostream& AddValue();
    /// Finish all options
    void Finish();
};

VizAttributePrinter::VizAttributePrinter(std::ostream& out) : out(out), started(false), finished(false) {}
VizAttributePrinter::~VizAttributePrinter() {
    if (started && !finished) {
        Finish();
    }
}

/// Add a key
void VizAttributePrinter::AddKey(std::string_view key) {
    if (!started) {
        started = true;
        out << " (\n    ";
    } else {
        out << ",\n    ";
    }
    out << key;
}
/// Start a value
std::ostream& VizAttributePrinter::AddValue() {
    out << " = ";
    return out;
}
/// Start a value
void VizAttributePrinter::Finish() {
    finished = true;
    out << "\n)";
}

VizStatement::VizStatement(ProgramInstance& instance, size_t statement_id, size_t target_node_id)
    : instance_(instance), statement_id_(statement_id), target_node_id_(target_node_id), components_() {}

/// Read a viz statement
std::unique_ptr<VizStatement> VizStatement::ReadFrom(ProgramInstance& instance, size_t stmt_id) {
    // clang-format off
    auto& program = instance.program();
    auto& stmt = program.statements[stmt_id];
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENTS, 1)
                .MatchArray(),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_TARGET, 0),
        });
    // clang-format on

    // Match root
    std::array<NodeMatch, 2> matches;
    if (!schema.Match(instance, stmt->root_node, matches)) return nullptr;
    auto comps_node_id = matches[1].node_id;
    auto& comps_node = program.nodes[comps_node_id];

    // Create the viz statement
    auto viz = std::make_unique<VizStatement>(instance, stmt_id, matches[0].node_id);

    // Read all components
    std::vector<std::unique_ptr<viz::VizComponent>> components;
    components.reserve(comps_node.children_count());
    for (auto cid = 0; cid < comps_node.children_count(); ++cid) {
        auto begin = comps_node.children_begin_or_value();
        auto comp = viz::VizComponent::CreateFrom(*viz, begin + cid);
        components.push_back(move(comp));
    }
    viz->components_ = std::move(components);
    return viz;
}

/// Print statement as script
void VizStatement::PrintScript(std::ostream& out) const {
    auto& nodes = instance_.program().nodes;

    out << "VIZ ";
    out << instance_.TextAt(nodes[target_node_id_].location());
    out << " USING";
    for (auto i = 0; i < components_.size(); ++i) {
        if (i > 0) {
            out << ", ";
        }
        components_[i]->PrintScript(out);
    }
}

/// Pack the viz specs
flatbuffers::Offset<proto::viz::VizSpec> VizStatement::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Pack components
    std::vector<fb::Offset<proto::viz::VizComponent>> component_offsets;
    for (auto& c : components_) {
        auto component = c->Pack(builder);
        component_offsets.push_back(component);
    }
    auto component_ofs_vec = builder.CreateVector(component_offsets);

    // Pack title (if any)
    std::optional<fb::Offset<fb::String>> title_offset;
    if (title_) {
        title_offset = builder.CreateString(*title_);
    }

    // Build viz spec
    assert(computed_position_.has_value());
    pv::VizSpecBuilder spec_builder{builder};
    spec_builder.add_statement_id(statement_id_);
    spec_builder.add_components(component_ofs_vec);
    spec_builder.add_position(&computed_position_.value());
    if (title_offset) spec_builder.add_title(*title_offset);
    return spec_builder.Finish();
}

/// Constructor
VizComponent::VizComponent(VizStatement& viz) : viz_stmt_(viz) {}

/// Read common viz attributes.
void VizComponent::ReadFrom(size_t node_id) {
    constexpr size_t ID_TYPE = 0;
    constexpr size_t ID_TYPE_MODIFIERS = 1;
    constexpr size_t ID_POS_ROW = 2;
    constexpr size_t ID_POS_COLUMN = 3;
    constexpr size_t ID_POS_WIDTH = 4;
    constexpr size_t ID_POS_HEIGHT = 5;
    constexpr size_t ID_STACK = 13;
    constexpr size_t ID_GROUP = 29;
    constexpr size_t ID_ORDER = 33;
    constexpr size_t ID_SAMPLES = 31;
    constexpr size_t ID_X = 6;
    constexpr size_t ID_Y = 7;
    constexpr size_t ID_Y0 = 8;
    constexpr size_t ID_DATA_STACK = 12;
    constexpr size_t ID_DATA_GROUP = 30;
    constexpr size_t ID_DATA_ORDER = 34;
    constexpr size_t ID_DATA_SAMPLES = 32;
    constexpr size_t ID_DATA_X = 9;
    constexpr size_t ID_DATA_Y = 10;
    constexpr size_t ID_DATA_Y0 = 11;
    constexpr size_t ID_STYLE_DATA = 28;
    constexpr size_t ID_STYLE_LABELS = 13;
    constexpr size_t ID_THEME = 14;
    constexpr size_t ID_DATA = 15;
    constexpr size_t ID_ROW = 16;
    constexpr size_t ID_COLUMN = 17;
    constexpr size_t ID_WIDTH = 18;
    constexpr size_t ID_HEIGHT = 19;
    constexpr size_t ID_DOMAIN = 20;
    constexpr size_t ID_DOMAIN_X = 21;
    constexpr size_t ID_DOMAIN_Y = 22;
    constexpr size_t ID_DOMAIN_PADDING = 23;
    constexpr size_t ID_DOMAIN_PADDING_X = 24;
    constexpr size_t ID_DOMAIN_PADDING_Y = 25;
    constexpr size_t ID_STYLE_DATA_FILL = 26;
    constexpr size_t ID_FILL = 27;
    constexpr size_t ID_TITLE = 28;

    // clang-format off
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_DASHQL_VIZ_COMPONENT)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE, ID_TYPE)
                .MatchEnum(sx::NodeType::ENUM_DASHQL_VIZ_COMPONENT_TYPE),
            sxm::Attribute(sx::AttributeKey::DASHQL_VIZ_COMPONENT_TYPE_MODIFIERS, ID_TYPE_MODIFIERS)
                .MatchUI32Bitmap(),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, ID_COLUMN),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_DATA, ID_DATA)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_GROUP, ID_DATA_GROUP),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ORDER, ID_DATA_ORDER),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_SAMPLES, ID_DATA_SAMPLES),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_STACK, ID_DATA_STACK),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_X, ID_DATA_X),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y, ID_DATA_Y),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y0, ID_DATA_Y0),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_DOMAIN, ID_DOMAIN)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_X, ID_DOMAIN_X),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y, ID_DOMAIN_Y)
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_DOMAIN, ID_DOMAIN_PADDING)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_X, ID_DOMAIN_PADDING_X),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y, ID_DOMAIN_PADDING_Y)
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_FILL, ID_FILL),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_GROUP, ID_GROUP),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, ID_HEIGHT),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_ORDER, ID_ORDER),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_POSITION)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_COLUMN, ID_POS_COLUMN),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_HEIGHT, ID_POS_HEIGHT),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, ID_POS_ROW),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, ID_POS_WIDTH),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_ROW, ID_ROW),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_STACK, ID_STACK),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_STYLE)
                .MatchOptions()
                .MatchChildren({
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_DATA, ID_STYLE_DATA)
                        .MatchOptions()
                        .MatchChildren({
                            sxm::Option(sx::AttributeKey::DASHQL_OPTION_FILL, ID_STYLE_DATA_FILL),
                            sxm::Option(sx::AttributeKey::DASHQL_OPTION_FILL_OPACITY),
                            sxm::Option(sx::AttributeKey::DASHQL_OPTION_FONT),
                            sxm::Option(sx::AttributeKey::DASHQL_OPTION_FONT_SIZE),
                            sxm::Option(sx::AttributeKey::DASHQL_OPTION_OPACITY),
                            sxm::Option(sx::AttributeKey::DASHQL_OPTION_STROKE),
                        }),
                    sxm::Option(sx::AttributeKey::DASHQL_OPTION_LABELS, ID_STYLE_LABELS),
                }),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_THEME, ID_THEME),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_TITLE, ID_TITLE),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_WIDTH, ID_WIDTH),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_X, ID_X),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y, ID_Y),
            sxm::Option(sx::AttributeKey::DASHQL_OPTION_Y0, ID_Y0),
        });
    // clang-format on

    std::array<NodeMatch, 35> matches;
    schema.Match(viz_stmt_.instance(), node_id, matches);

    // Read type
    if (matches[0]) {
        type_ = matches[0].DataAsEnum<sx::VizComponentType>();
    }
    // Read type modifiers
    if (matches[1]) {
        type_modifiers_ = matches[1].DataAsI64();
    }

    /// Build the type mask for fast compatibility checks.
    /// This will obviously break as soon as we've got more than > 64 component types.
    static_assert(static_cast<size_t>(sx::VizComponentType::MAX) <= 63);
    uint64_t type_mask = 1 << static_cast<size_t>(type_);

    // Report that option is not unique
    auto report_not_unique = [this](size_t node_id, std::string_view key) {
        if (node_id == INVALID_NODE_ID) return;
        viz_stmt_.instance().Add(LinterMessage{LinterMessageCode::OPTION_NOT_UNIQUE, node_id}
                                 << "option '" << key << "' must be unique across components");
    };

    /// Get position attributes
    auto pos_row = SelectAltOption("position.row", matches[ID_POS_ROW].node_id, matches[ID_ROW].node_id);
    auto pos_column = SelectAltOption("position.column", matches[ID_POS_COLUMN].node_id, matches[ID_COLUMN].node_id);
    auto pos_width = SelectAltOption("position.width", matches[ID_POS_WIDTH].node_id, matches[ID_WIDTH].node_id);
    auto pos_height = SelectAltOption("position.height", matches[ID_POS_HEIGHT].node_id, matches[ID_HEIGHT].node_id);
    if (AnyOptionSet({pos_row, pos_column, pos_width, pos_height})) {
        // Already provided by a previous component?
        if (viz_stmt_.specified_position()) {
            report_not_unique(pos_row, "position.row");
            report_not_unique(pos_column, "position.column");
            report_not_unique(pos_width, "position.width");
            report_not_unique(pos_height, "position.height");
        } else {
            auto r = viz_stmt_.instance_.ReadNodeValueOrNull(pos_row).CastAsUI64().value_or(0);
            auto c = viz_stmt_.instance_.ReadNodeValueOrNull(pos_column).CastAsUI64().value_or(0);
            auto w = viz_stmt_.instance_.ReadNodeValueOrNull(pos_width).CastAsUI64().value_or(0);
            auto h = viz_stmt_.instance_.ReadNodeValueOrNull(pos_height).CastAsUI64().value_or(0);
            position_ = proto::viz::VizPosition(r, c, w, h);
            viz_stmt_.specified_position() = &position_.value();
        }
    }

    /// Get data attributes
    auto data_group = SelectAltOption("data.group", matches[ID_DATA_GROUP].node_id, matches[ID_GROUP].node_id);
    auto data_stack = SelectAltOption("data.stack", matches[ID_DATA_STACK].node_id, matches[ID_STACK].node_id);
    auto data_order = SelectAltOption("data.order", matches[ID_DATA_ORDER].node_id, matches[ID_ORDER].node_id);
    auto data_samples = SelectAltOption("data.samples", matches[ID_DATA_SAMPLES].node_id, matches[ID_SAMPLES].node_id);
    auto data_x = SelectAltOption("data.x", matches[ID_DATA_X].node_id, matches[ID_X].node_id);
    auto data_y = SelectAltOption("data.y", matches[ID_DATA_Y].node_id, matches[ID_Y].node_id);
    if (AnyOptionSet({data_x, data_y, data_group, data_stack, data_order, data_samples})) {
        data_.emplace();
        data_->group = ReadColumnRefs(data_group);
        data_->stack = ReadColumnRefs(data_stack);
        data_->order = ReadColumnRefs(data_stack);
        data_->x = ReadColumnRefs(data_x);
        data_->y = ReadColumnRefs(data_y);
        data_->samples = viz_stmt_.instance_.ReadNodeValueOrNull(pos_row).CastAsUI64().value_or(0);
    }

    /// Get the title attribute
    if (matches[ID_TITLE]) {
        if (viz_stmt_.title()) {
            report_not_unique(matches[ID_TITLE].node_id, "title");
        } else {
            auto title = viz_stmt_.instance_.ReadNodeValueOrNull(matches[ID_TITLE].node_id).PrintValue();
            trim(title, isNoQuote);
            title_ = std::move(title);
            viz_stmt_.title() = title_;
        }
    }

    /// Match style attribute
    std::vector<pv::SVGStyleProperty> style;
    AddAltStyleOption("style.data.fill", matches[ID_STYLE_DATA_FILL].node_id, pv::SVGStylePropertyType::FILL, style);
}

/// Select an option
bool VizComponent::AnyOptionSet(std::initializer_list<size_t> node_ids) const {
    bool any = false;
    for (auto node_id : node_ids) {
        any |= node_id < INVALID_NODE_ID;
    }
    return any;
}

/// Select an option with alternative
size_t VizComponent::SelectAltOption(std::string_view label, size_t node_id, size_t alt_node_id) const {
    auto& instance = viz_stmt_.instance();
    size_t selection = INVALID_NODE_ID;
    if (node_id < INVALID_NODE_ID) {
        selection = node_id;
        if (alt_node_id < INVALID_NODE_ID) {
            instance.Add(LinterMessage{LinterMessageCode::OPTION_ALTERNATIVE_STYLE, alt_node_id}
                         << "option superseded by '" << label << "'");
        }
    } else if (alt_node_id < INVALID_NODE_ID) {
        selection = alt_node_id;
        instance.Add(LinterMessage{LinterMessageCode::OPTION_ALTERNATIVE_STYLE, alt_node_id}
                     << "option should be specified as '" << label << "'");
    }
    return selection;
}

/// Match an alternative style option
void VizComponent::AddAltStyleOption(std::string_view label, size_t node_id, pv::SVGStylePropertyType prop,
                                     std::vector<pv::SVGStyleProperty>& out) const {
    if (node_id == INVALID_NODE_ID) return;
    auto& instance = viz_stmt_.instance();
    instance.Add(LinterMessage{LinterMessageCode::OPTION_ALTERNATIVE_STYLE, node_id}
                 << "option should be specified as '" << label << "'");
    auto p = pv::SVGStyleProperty(pv::SVGStyleTarget::DATA, prop, node_id);
    out.push_back(std::move(p));
}

/// Read component from a node
std::unique_ptr<VizComponent> VizComponent::CreateFrom(VizStatement& stmt, size_t node_id) {
    auto c = std::make_unique<VizComponent>(stmt);
    c->ReadFrom(node_id);
    return c;
}

/// Read column refs as text vector
std::vector<std::string> VizComponent::ReadColumnRefs(size_t target_node_id) const {
    if (target_node_id == INVALID_NODE_ID) return {};
    auto& instance = viz_stmt_.instance();
    auto& nodes = instance.program().nodes;
    auto& target_node = nodes[target_node_id];

    switch (target_node.node_type()) {
        case sx::NodeType::ARRAY: {
            auto begin = target_node.children_begin_or_value();
            auto end = begin + target_node.children_count();
            std::vector<std::string_view> refs;
            refs.reserve(end - begin);
            for (size_t i = begin; i < end; ++i) {
                if (auto v = ReadColumnRef(i); !v.empty())
                    refs.push_back(v);
            }
            break;
        }
        case sx::NodeType::OBJECT_SQL_COLUMN_REF:
            return {std::string{ReadColumnRef(target_node_id)}};
        default:
            break;
    }
    return {};
}

/// Read double
double VizComponent::ReadDouble(size_t node_id) const {
    if (node_id == INVALID_NODE_ID) return {};
    auto& instance = viz_stmt_.instance();
    auto& nodes = instance.program().nodes;
    auto& target_node = nodes[node_id];
    switch (target_node.node_type()) {
        case sx::NodeType::BOOL:
            return target_node.children_begin_or_value();
        case sx::NodeType::UI32:
        case sx::NodeType::UI32_BITMAP:
            return target_node.children_begin_or_value();
        case sx::NodeType::STRING_REF: {
            auto txt = instance.TextAt(target_node.location());
            imemstream txtstr{txt.data(), txt.length()};
            double d = 0;
            txtstr >> d;
            return d;
        }
        default:
            break;
    }
    return 0.0;
}

/// Read a column ref as text
std::string_view VizComponent::ReadColumnRef(size_t target_node_id) const {
    if (target_node_id == INVALID_NODE_ID) return {};
    auto& instance = viz_stmt_.instance();
    auto& nodes = instance.program().nodes;
    auto& target_node = nodes[target_node_id];

    // Get a string ref?
    if (target_node.node_type() == sx::NodeType::STRING_REF) {
        return instance.TextAt(target_node.location());
    }

    // clang-format off
    constexpr size_t ID_COLUMN_REF_PATH = 0;
    static const auto schema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_SQL_COLUMN_REF)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::SQL_COLUMN_REF_PATH, ID_COLUMN_REF_PATH)
                .MatchArray()
        });
    std::array<NodeMatch, 1> matches;
    schema.Match(instance, target_node_id, matches);
    // clang-format on

    // Is a column ref path?
    if (matches[ID_COLUMN_REF_PATH]) {
        auto node_id = matches[ID_COLUMN_REF_PATH].node_id;
        auto& node = instance.program().nodes[node_id];
        return trimview(instance.TextAt(node.location()), isNoQuote);
    }
    return {nullptr, 0};
}

/// Print common viz attributes
void VizComponent::PrintScript(std::ostream& out) const {
    // Print the type modifiers
    static constexpr std::array<std::string_view, 6> type_modifier_names = {
        "STACKED", "DEPENDENT", "INDEPENDENT", "POLAR", "X", "Y",
    };
    for (uint32_t i = 0, modifiers = type_modifiers_; i < 6; ++i, modifiers >>= 1) {
        if ((modifiers & 0b1) == 0) continue;
        out << " " << type_modifier_names[i];
    }

    // Print the type name
    static constexpr std::array<std::string_view, 14> type_names = {
        "AREA", "AXIS",   "BAR", "BOX",     "CANDLESTICK", "ERROR_BAR", "HISTOGRAM",
        "LINE", "NUMBER", "PIE", "SCATTER", "TABLE",       "TEXT",      "VORONOI",
    };
    out << " " << type_names[static_cast<size_t>(type_)];

    VizAttributePrinter aout{out};
    if (auto& p = position_; p.has_value()) {
        aout.AddKey("pos");
        aout.AddValue() << "(r = " << p->row() << ", c = " << p->column() << ", w = " << p->width()
                        << ", h = " << p->height() << ")";
    }
    if (auto& t = title_; t.has_value()) {
        aout.AddKey("title");
        aout.AddValue() << "'" << *t << "'";
    }
}

/// Pack as buffer
flatbuffers::Offset<proto::viz::VizComponent> VizComponent::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Pack modifiers
    std::vector<uint8_t> modifiers;
    for (uint32_t i = 0, m = type_modifiers_; i < 6; ++i, m >>= 1) {
        if ((m & 0b1) == 0) continue;
        modifiers.push_back(i);
    }
    auto modifiers_vec = builder.CreateVector(modifiers);

    // Pack data
    std::optional<flatbuffers::Offset<pv::VizData>> data = std::nullopt;
    if (data_) {
        auto x = data_->x.empty() ? std::nullopt : std::optional{builder.CreateVectorOfStrings(data_->x)};
        auto y = data_->y.empty() ? std::nullopt : std::optional{builder.CreateVectorOfStrings(data_->y)};
        auto group = data_->group.empty() ? std::nullopt : std::optional{builder.CreateVectorOfStrings(data_->group)};
        auto stack = data_->stack.empty() ? std::nullopt : std::optional{builder.CreateVectorOfStrings(data_->stack)};
        auto order = data_->order.empty() ? std::nullopt : std::optional{builder.CreateVectorOfStrings(data_->order)};

        pv::VizDataBuilder dataBuilder{builder};
        if (x) dataBuilder.add_x(*x);
        if (y) dataBuilder.add_x(*y);
        if (group) dataBuilder.add_x(*group);
        if (stack) dataBuilder.add_x(*stack);
        if (order) dataBuilder.add_x(*order);
        dataBuilder.add_samples(data_->samples);
        data = dataBuilder.Finish();
    }

    // Pack component
    proto::viz::VizComponentBuilder cb{builder};
    cb.add_type(type_);
    cb.add_type_modifiers(modifiers_vec);
    if (data) cb.add_data(*data);
    return cb.Finish();
}

}  // namespace viz
}  // namespace dashql