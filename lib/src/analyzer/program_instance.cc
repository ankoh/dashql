#include "dashql/analyzer/program_instance.h"

#include "arrow/scalar.h"
#include "arrow/type_fwd.h"
#include "arrow/visitor_inline.h"
#include "dashql/analyzer/program_linter.h"
#include "dashql/analyzer/stmt/input_stmt.h"
#include "dashql/analyzer/stmt/viz_stmt.h"
#include "dashql/analyzer/value_packing.h"
#include "dashql/analyzer/value_printing.h"
#include "dashql/common/memstream.h"
#include "dashql/common/string.h"
#include "dashql/common/substring_buffer.h"
#include "dashql/common/variant.h"
#include "dashql/proto_generated.h"

namespace dashql {

static std::unordered_map<std::string_view, uint16_t> BuildDSONDictionary(std::string_view text,
                                                                          std::vector<sx::Location> keys) {
    std::unordered_map<std::string_view, uint16_t> dict;
    dict.reserve(keys.size());
    for (auto i = 0; i < keys.size(); ++i) {
        auto& key = keys[i];
        dict.insert({text.substr(key.offset(), key.length()), i});
    }
    return dict;
}

// Constructor
ProgramInstance::ProgramInstance(std::shared_ptr<std::string> text, std::shared_ptr<sx::ProgramT> program,
                                 std::vector<InputValue> params)
    : program_text_(move(text)),
      program_(move(program)),
      dson_dictionary_(*program_text_, *program_),
      input_values_(move(params)),
      evaluated_nodes_(program_->nodes.size()) {}

// Add a node error
void ProgramInstance::AddNodeError(NodeError&& error) { node_errors_.push_back(std::move(error)); }
// Add a linter message
LinterMessage& ProgramInstance::AddLinterMessage(LinterMessageCode code, size_t node_id) {
    linter_messages_.emplace_back(code, node_id);
    return linter_messages_.back();
}

// Find a parameter value
const InputValue* ProgramInstance::FindInputValue(size_t stmt_id) const {
    // XXX check if valid
    return &input_values_[stmt_id];
}

/// Read a node value
std::shared_ptr<arrow::Scalar> ProgramInstance::ReadNodeValue(size_t node_id) {
    if (auto* node = evaluated_nodes_.Find(node_id); !!node) {
        return node->value;
    }
    auto v = arrow::MakeNullScalar(arrow::null());
    auto& n = program_->nodes[node_id];
    switch (n.node_type()) {
        case proto::syntax::NodeType::BOOL:
            v = arrow::MakeScalar(arrow::boolean(), n.children_begin_or_value() != 0).ValueOr(v);
            break;
        case proto::syntax::NodeType::UI32:
        case proto::syntax::NodeType::UI32_BITMAP:
            v = arrow::MakeScalar(arrow::int64(), n.children_begin_or_value()).ValueOr(v);
            break;
        case proto::syntax::NodeType::STRING_REF:
            v = std::make_shared<arrow::StringScalar>(std::string{TextAt(n.location())});
            break;
        default:
            break;
    }
    return v;
}

/// Read a node value
ProgramInstance::QualifiedName ProgramInstance::ReadQualifiedName(size_t node_id, bool lift_global) {
    auto& node = program_->nodes[node_id];
    QualifiedName qn;

    // clang-format off
    static const auto indirectSchema = sxm::Element()
        .MatchObject(sx::NodeType::OBJECT_SQL_INDIRECTION_INDEX)
        .MatchChildren({
            sxm::Attribute(sx::AttributeKey::SQL_INDIRECTION_INDEX_VALUE, 0)
                .MatchString()
        });
    // clang-format on
    auto indirection = [&]() -> std::optional<std::string_view> {
        auto ast = indirectSchema.Match(*this, node_id, 1);
        if (!ast.IsFullMatch()) return std::nullopt;
        return TextAt(program_->nodes[ast[0].node_id].location());
    };

    // Is string?
    if (node.node_type() == sx::NodeType::STRING_REF) {
        qn.name = TextAt(node.location());
    }

    // Is array?
    else if (node.node_type() == sx::NodeType::ARRAY) {
        auto begin = node.children_begin_or_value();
        auto count = node.children_count();
        switch (count) {
            case 0:
                break;
            case 1:
                qn.name = trimview(TextAt(program_->nodes[begin].location()), isNoQuote);
                break;
            case 2:
                qn.schema = trimview(TextAt(program_->nodes[begin].location()), isNoQuote);
                qn.name = trimview(TextAt(program_->nodes[begin + 1].location()), isNoQuote);
                break;
            case 3:
            default:
                qn.schema = trimview(TextAt(program_->nodes[begin].location()), isNoQuote);
                qn.name = trimview(TextAt(program_->nodes[begin + 1].location()), isNoQuote);
                break;
        }
    }

    // Is table ref?
    else if (node.node_type() == sx::NodeType::OBJECT_SQL_TABLE_REF) {
        if (auto name_id = FindAttribute(node, sx::AttributeKey::SQL_TABLE_NAME); name_id) {
            return ReadQualifiedName(*name_id, true);
        }
    }

    // Lift into global namespace?
    if (qn.schema.empty() && lift_global) qn.schema = script_options_.global_namespace;
    return qn;
}

// Collect the statement options
arrow::Result<std::string> ProgramInstance::RenderStatementText(size_t stmt_id) const {
    auto& target_root = program_->nodes[program_->statements[stmt_id]->root_node];
    SubstringBuffer buffer{*program_text_, target_root.location()};

    // Replace all interpolated nodes
    evaluated_nodes_.IterateValues([&](size_t, const NodeValue& node_value) {
        // Intersects with buffer?
        auto& node = program_->nodes[node_value.root_node_id];
        auto node_loc = node.location();
        if (!buffer.Intersects(node_loc)) return;

        // Replace in buffer
        auto vstr = PrintScript(*node_value.value);
        buffer.Replace(node_loc, vstr);
    });

    // Return the result
    return buffer.Finish();
}

/// Pack the evaluated nodes
arrow::Result<flatbuffers::Offset<proto::analyzer::ProgramAnnotations>> ProgramInstance::PackAnnotations(
    flatbuffers::FlatBufferBuilder& builder) const {
    // Pack input values
    std::vector<flatbuffers::Offset<proto::analyzer::InputValue>> input_offsets;
    input_offsets.reserve(input_values_.size());
    for (auto& param : input_values_) {
        ARROW_ASSIGN_OR_RAISE(auto v, param.Pack(builder));
        input_offsets.push_back(v);
    }
    auto input_vec = builder.CreateVector(input_offsets);

    // Pack the evaluated nodes
    std::vector<flatbuffers::Offset<proto::analyzer::NodeValue>> eval_nodes;
    evaluated_nodes_.IterateValues([&](size_t /*node_id*/, const NodeValue& node_value) {
        auto vb = PackValue(builder, *node_value.value).ValueUnsafe();
        proto::analyzer::NodeValueBuilder nv{builder};
        nv.add_node_id(node_value.root_node_id);
        nv.add_value(vb);
        eval_nodes.push_back(nv.Finish());
    });
    auto eval_node_vec = builder.CreateVector(eval_nodes);

    // Pack the liveness map
    auto liveness_vec = builder.CreateVector(statements_liveness_);

    // Pack the fetchs
    std::vector<flatbuffers::Offset<proto::analyzer::FetchStatement>> fetchs;
    for (auto& fetch : fetch_statements_) {
        fetchs.push_back(fetch->Pack(builder));
    }
    auto fetchs_vec = builder.CreateVector(fetchs);

    // Pack the fetchs
    std::vector<flatbuffers::Offset<proto::analyzer::SetStatement>> sets;
    for (auto& set : set_statements_) {
        sets.push_back(set->Pack(builder));
    }
    auto trans_vec = builder.CreateVector(sets);

    // Pack the loads
    std::vector<flatbuffers::Offset<proto::analyzer::LoadStatement>> loads;
    for (auto& load : load_statements_) {
        loads.push_back(load->Pack(builder));
    }
    auto loads_vec = builder.CreateVector(loads);

    // Pack the cards
    std::vector<flatbuffers::Offset<proto::analyzer::Card>> cards;
    for (auto& input : input_statements_) {
        cards.push_back(input->PackCard(builder));
    }
    for (auto& viz : viz_statements_) {
        cards.push_back(viz->PackCard(builder));
    }
    auto cards_vec = builder.CreateVector(cards);

    // Encode the plan result
    proto::analyzer::ProgramAnnotationsBuilder annotations{builder};
    annotations.add_evaluated_nodes(eval_node_vec);
    annotations.add_input_values(input_vec);
    annotations.add_statements_liveness(liveness_vec);
    annotations.add_statements_fetch(fetchs_vec);
    annotations.add_statements_load(loads_vec);
    annotations.add_cards(cards_vec);
    // XXX node errors
    // XXX linter messages
    return annotations.Finish();
}

/// Find an attribute
std::optional<size_t> ProgramInstance::FindAttribute(const sx::Node& origin, sx::AttributeKey key) const {
    auto children_begin = origin.children_begin_or_value();
    auto children_count = origin.children_count();
    auto lb = children_begin;
    auto c = children_count;
    while (c > 0) {
        auto step = c / 2;
        auto iter = lb + step;
        auto& n = program_->nodes[iter];
        if (n.attribute_key() < static_cast<uint16_t>(key)) {
            lb = iter + 1;
            c -= step + 1;
        } else {
            c = step;
        }
    }
    if (lb >= children_begin + children_count) {
        return std::nullopt;
    }
    auto& n = program_->nodes[lb];
    return (n.attribute_key() == static_cast<uint16_t>(key)) ? std::optional<size_t>{lb} : std::nullopt;
}

}  // namespace dashql
