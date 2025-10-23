#include "dashql/view/plan_view_model.h"

#include <iostream>
#include <sstream>
#include <string_view>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/intrusive_list.h"
#include "frozen/bits/elsa_std.h"
#include "frozen/unordered_map.h"
#include "rapidjson/document.h"
#include "rapidjson/rapidjson.h"
#include "rapidjson/reader.h"
#include "rapidjson/stringbuffer.h"
#include "rapidjson/writer.h"

namespace dashql {

constexpr unsigned PARSE_FLAGS = rapidjson::ParseFlag::kParseCommentsFlag | rapidjson::ParseFlag::kParseNanAndInfFlag |
                                 rapidjson::ParseFlag::kParseTrailingCommasFlag |
                                 rapidjson::ParseFlag::kParseEscapedApostropheFlag |
                                 rapidjson::ParseFlag::kParseValidateEncodingFlag;

namespace {

// The logic is the following:
// - We do a post-order DFS traversal
// - Whenever we find an operator, we re-construct the path toward the lowest operator ancestor
struct ParserDFSNode {
    /// The json value
    rapidjson::Value* json_value = nullptr;
    /// The DFS visited marker for the post-order traversal
    bool visited = false;
    /// The parent index in the DFS
    std::optional<size_t> parent_node_index = std::nullopt;
    /// The refernce in the parent
    PlanViewModel::PathComponent parent_path = std::monostate{};
    /// Is an operator?
    std::optional<std::string_view> operator_type = std::nullopt;
    /// The attributes
    std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> attributes;
    /// The already emitted children
    IntrusiveList<PlanViewModel::ParsedOperatorNode> child_operators;

    /// Constructor
    ParserDFSNode(rapidjson::Value& json_value, std::optional<size_t> parent_node_index,
                  PlanViewModel::PathComponent parent_child_type)
        : json_value(&json_value), parent_node_index(parent_node_index), parent_path(parent_child_type) {}
};

/// A path builder
struct AncestorPathBuilder {
    /// The current path
    std::vector<PlanViewModel::PathComponent> path;
    /// Build an ancestor path
    std::pair<std::optional<size_t>, std::vector<PlanViewModel::PathComponent>> findAncestor(
        std::span<ParserDFSNode> nodes, size_t next);
};

/// Build an ancestor path
std::pair<std::optional<size_t>, std::vector<PlanViewModel::PathComponent>> AncestorPathBuilder::findAncestor(
    std::span<ParserDFSNode> nodes, size_t next) {
    path.clear();

    // Check the current node
    auto& node = nodes[next];
    if (node.parent_node_index.has_value()) {
        path.push_back(node.parent_path);
        next = node.parent_node_index.value();
    } else {
        return {std::nullopt, {}};
    }

    // Walk upwards until we hit the root or an operator
    while (true) {
        auto& node = nodes[next];
        if (node.operator_type.has_value()) {
            std::reverse(path.begin(), path.end());
            return {next, std::move(path)};
        } else if (!node.parent_node_index.has_value()) {
            std::reverse(path.begin(), path.end());
            return {std::nullopt, std::move(path)};
        } else {
            path.push_back(node.parent_path);
            next = node.parent_node_index.value();
        }
    }
}

}  // namespace

PlanViewModel::PlanViewModel() {}

buffers::status::StatusCode PlanViewModel::ParseHyperPlan(std::string plan_json) {
    AncestorPathBuilder path_builder;

    // Store the input before parsing in-situ (the document will hold pointers into this string)
    input = std::move(plan_json);

    // Parse the document.
    // Note that ParseInsitu is destructive, input will no longer hold valid json afterwards.
    document.ParseInsitu<PARSE_FLAGS>(input.data());
    if (document.HasParseError()) {
        return buffers::status::StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR;
    }

    // Run DFS over the json plan
    std::vector<ParserDFSNode> pending;
    pending.emplace_back(document, std::nullopt, std::monostate{});
    do {
        ParserDFSNode& current = pending.back();
        auto current_index = pending.size() - 1;

        // Already visited?
        if (current.visited) {
            // Is an operator?
            if (current.operator_type.has_value()) {
                // Build the ancestor path
                auto [ancestor, ancestor_path] = path_builder.findAncestor(pending, current_index);
                // Then emit the node.
                auto& op = parsed_operators.PushBack(PlanViewModel::ParsedOperatorNode{
                    std::move(ancestor_path), *current.json_value, current.operator_type.value(),
                    current.child_operators.CastAsBase()});
                if (ancestor.has_value()) {
                    // Register as child operator in ancestor
                    pending[ancestor.value()].child_operators.PushBack(op);
                } else {
                    // No parent operator, register as root
                    root_operators.push_back(op);
                }
            } else {
                // Otherwise do nothing, we're serializing the attributes later
            }
            pending.pop_back();
            continue;
        }
        // Mark as visited
        current.visited = true;

        switch (current.json_value->GetType()) {
            // Current node is an object:
            // - Add children for DFS
            // - Check if it is an operator
            case rapidjson::Type::kObjectType: {
                auto o = current.json_value->GetObject();
                for (auto iter = o.MemberBegin(); iter != o.MemberEnd(); ++iter) {
                    assert(iter->name.IsString());
                    std::string_view attribute_name{iter->name.GetString()};
                    size_t pending_begin = pending.size();

                    // Is the current node an operator?
                    if (attribute_name == "operator" && iter->value.IsString()) {
                        // Mark as such and skip attribute during DFS
                        std::string_view operator_type = iter->value.GetString();
                        pending[current_index].operator_type = operator_type;
                    } else {
                        // Remember as attribute
                        pending[current_index].attributes.emplace_back(attribute_name, iter->value);
                        // Mark pending for DFS traversal
                        pending.emplace_back(iter->value, current_index, MemberInObject(attribute_name));
                    }

                    // Reverse the order of the attribute nodes on the stack
                    std::reverse(pending.begin() + pending_begin, pending.end());
                }
                break;
            }
            // Current node is an array:
            // - Add children for DFS
            case rapidjson::Type::kArrayType: {
                auto values = current.json_value->GetArray();
                for (size_t i = values.Size(); i > 0; --i) {
                    size_t j = i - 1;
                    auto& child_value = values[j];
                    pending.emplace_back(child_value, current_index, EntryInArray(j));
                }
                break;
            }

            case rapidjson::Type::kFalseType:
            case rapidjson::Type::kNullType:
            case rapidjson::Type::kNumberType:
            case rapidjson::Type::kStringType:
            case rapidjson::Type::kTrueType:
                // Skip value nodes during DFS traversal
                break;
        }
    } while (!pending.empty());

    FlattenOperators();
    IdentifyHyperPipelines();

    return buffers::status::StatusCode::OK;
}

namespace {

enum class KnownPipelineBehavior {
    BreaksAll,
    Passthrough,
    DependsOnJoinMethod,
};
enum class KnownJoinPipelineBehavior {
    BreaksAll,
    BreaksLeft,
    BreaksRight,
};

// clang-format off
using namespace std::literals::string_view_literals;
constexpr auto HYPER_PIPELINE_BEHAVIOR_ENTRIES = std::array{
    std::pair{"arrowscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"assertsingle"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"batchudfexpressionoperator"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"binaryscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"csvscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"cursorcreate"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"cursorscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"debugprint"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"delete"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"distribute"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"earlyprobe"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"except"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"exceptall"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"executiontarget"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"explainanalyze"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"explicitscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"externalformatexport"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"federate"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"foreigntablescan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"groupby"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"groupjoin"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"icebergscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"insert"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"intersect"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"intersectall"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"iteration"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"iterationincrement"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"join"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"kmeans"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"leftantijoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"leftmarkjoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"leftouterjoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"leftsemijoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"leftsinglejoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"map"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"naivebayespredict"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"optimizationbarrier"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"parquetscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"rawsqlsubquery"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"resultscan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"rightantijoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"rightmarkjoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"rightouterjoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"rightsemijoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"rightsinglejoin"sv, KnownPipelineBehavior::DependsOnJoinMethod},
    std::pair{"securebarrier"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"select"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"share"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"sort"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"tableconstruction"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"tablefunction"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"tablesample"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"tablescan"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"udtablefunction"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"union"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"unionall"sv, KnownPipelineBehavior::Passthrough},
    std::pair{"update"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"virtualtable"sv, KnownPipelineBehavior::BreaksAll},
    std::pair{"window"sv, KnownPipelineBehavior::BreaksAll},
};

constexpr auto HYPER_PIPELINE_BEHAVIOR_HASH_JOIN_ENTRIES = std::array{
    std::pair{"fullouterjoin"sv, KnownJoinPipelineBehavior::BreaksLeft},   // Build left, probe right, produce remaining left
    std::pair{"join"sv, KnownJoinPipelineBehavior::BreaksLeft},            // Build left, probe right
    std::pair{"leftantijoin"sv, KnownJoinPipelineBehavior::BreaksAll},     // Build left, mark right, produce left
    std::pair{"leftmarkjoin"sv, KnownJoinPipelineBehavior::BreaksLeft},    // Build left, mark right
    std::pair{"leftouterjoin"sv, KnownJoinPipelineBehavior::BreaksLeft},   // Build left, probe right, produce remaining left
    std::pair{"leftsemijoin"sv, KnownJoinPipelineBehavior::BreaksLeft},    // Build left, probe right
    std::pair{"leftsinglejoin"sv, KnownJoinPipelineBehavior::BreaksLeft},  // Build left, probe right
    std::pair{"rightantijoin"sv, KnownJoinPipelineBehavior::BreaksLeft},   // Build left, produce unjoined from right
    std::pair{"rightmarkjoin"sv, KnownJoinPipelineBehavior::BreaksLeft},   // Build left, probe right **
    std::pair{"rightouterjoin"sv, KnownJoinPipelineBehavior::BreaksLeft},  // Build left, probe right
    std::pair{"rightsemijoin"sv, KnownJoinPipelineBehavior::BreaksLeft},   // Build left, probe right
    std::pair{"rightsinglejoin"sv, KnownJoinPipelineBehavior::BreaksLeft}, // Build left, probe right
};

frozen::unordered_map<std::string_view, KnownPipelineBehavior, std::size(HYPER_PIPELINE_BEHAVIOR_ENTRIES)> HYPER_PIPELINE_BEHAVIOR{ HYPER_PIPELINE_BEHAVIOR_ENTRIES };
frozen::unordered_map<std::string_view, KnownJoinPipelineBehavior, std::size(HYPER_PIPELINE_BEHAVIOR_HASH_JOIN_ENTRIES)> HYPER_PIPELINE_BEHAVIOR_HASH_JOIN{ HYPER_PIPELINE_BEHAVIOR_HASH_JOIN_ENTRIES };
// clang-format on

}  // namespace

void PlanViewModel::IdentifyHyperPipelines() {
    // Hyper is currently not serializing pipelines to the plan.
    // We therefore do our best here to derive pipelines based on assumptions.
    // Note that this does not account for the physical mapping and can be wrong.

    // The operator tree has already been flattened.
    // - Scanning from left to right over `flat_operators` gives us a post-order DFS traversal.
    // - We therefore start with the leafs and then check
    //   ("parent-operator-type", "parent-path") pairs in "producer" order.
    // - We track "open" pipelines per operator and propagate them upwards.

    for (size_t i = 0; i < flat_operators.size(); ++i) {
        // We treat child-less operators always as pipeline sources, independent of the name
        auto& op = flat_operators[i];
        if (op.child_operators.empty()) {
            // Create pipeline with operator as source
            op.pipelines.push_back(RegisterPipeline());
            continue;
        }

        // Skip if there is no parent.
        if (!op.parent_operator_id.has_value()) {
            continue;
        }
        auto& parent_op = flat_operators[op.parent_operator_id.value()];
        auto& parent_path = op.parent_path;

        // Now auto-propagate pipelines that are not breaking at our operator
        std::vector<std::reference_wrapper<Pipeline>> open_pipelines;
        for (auto& pipeline : op.pipelines) {
            bool open_pipeline = true;
            for (auto& [k, v] : pipeline.get().edges) {
                auto& [from, to] = k;
                if (to == op.operator_id && v.target_breaks_pipeline()) {
                    open_pipeline = false;
                    break;
                }
            }
            if (open_pipeline) {
                open_pipelines.push_back(pipeline);
            }
        }

        // Check if we know the pipeline behavior.
        // Break pipelines if we don't.
        bool parent_breaks_pipelines = true;
        if (auto iter = HYPER_PIPELINE_BEHAVIOR.find(parent_op.operator_type); iter != HYPER_PIPELINE_BEHAVIOR.end()) {
            switch (iter->second) {
                case KnownPipelineBehavior::BreaksAll:
                    // Parent breaks all pipelines
                    parent_breaks_pipelines = true;
                    break;
                case KnownPipelineBehavior::Passthrough:
                    // Pass through all open pipelines to that operator
                    parent_breaks_pipelines = false;
                    break;
                case KnownPipelineBehavior::DependsOnJoinMethod:
                    // Read the method attribute
                    auto method_iter = parent_op.operator_attribute_map.find("method");
                    std::string_view method;
                    if (method_iter != parent_op.operator_attribute_map.end() && method_iter->second.get().IsString()) {
                        method = method_iter->second.get().GetString();
                    }
                    // Is a hash join?
                    std::optional<KnownJoinPipelineBehavior> join_behavior;
                    if (method == "hash") {
                        // Check the operator type in the hash join table
                        if (auto join_iter = HYPER_PIPELINE_BEHAVIOR_HASH_JOIN.find(parent_op.operator_type);
                            join_iter != HYPER_PIPELINE_BEHAVIOR_HASH_JOIN.end()) {
                            join_behavior = join_iter->second;
                        }
                    }
                    // Check the join behavior
                    if (join_behavior.has_value()) {
                        switch (join_behavior.value()) {
                            case KnownJoinPipelineBehavior::BreaksAll:
                                parent_breaks_pipelines = true;
                                break;
                            case KnownJoinPipelineBehavior::BreaksLeft:
                                // XXX Check if we're left
                                parent_breaks_pipelines = true;
                                break;
                            case KnownJoinPipelineBehavior::BreaksRight:
                                // XXX Check if we're right
                                parent_breaks_pipelines = true;
                                break;
                        }
                    } else {
                        // Break, if we're unsure
                        parent_breaks_pipelines = true;
                    }
                    break;
            }
        }

        // Create the pipeline edges for all open pipelines
        for (auto& pipeline : open_pipelines) {
            auto& p = pipeline.get();
            buffers::view::PlanPipelineEdge edge{0, p.pipeline_id, op.operator_id, parent_op.operator_id,
                                                 parent_breaks_pipelines};
            p.edges.insert({{op.operator_id, parent_op.operator_id}, edge});
        }
    }
}

PlanViewModel::Pipeline& PlanViewModel::RegisterPipeline() {
    uint32_t pipeline_id = pipelines.GetSize();
    return pipelines.PushBack({.pipeline_id = pipeline_id, .edges = {}});
}

void PlanViewModel::FlattenOperators() {
    // A DFS node
    struct OperatorDFSNode {
        /// The operator
        std::reference_wrapper<ParsedOperatorNode> op;
        /// Is visited
        bool visited;
    };

    // Prepare the operators
    std::vector<OperatorDFSNode> pending;
    for (auto iter = root_operators.rbegin(); iter != root_operators.rend(); ++iter) {
        pending.push_back({.op = *iter, .visited = false});
    }
    flat_operators.reserve(parsed_operators.GetSize());

    // Run the DFS
    std::unordered_map<const ParsedOperatorNode*, FlatOperatorNode> mapped;
    while (!pending.empty()) {
        auto& current = pending.back();
        auto current_index = pending.size() - 1;
        auto& op = current.op.get();

        // Translate nodes in DFS post-order
        if (current.visited) {
            // Translate children
            auto& parsed_children = op.child_operators.CastUnsafeAs<ParsedOperatorNode>();
            size_t children_begin = flat_operators.size();

            // Add child operators
            for (auto& child : parsed_children) {
                auto iter = mapped.find(&child);
                assert(iter != mapped.end());
                assert(flat_operators.size() < flat_operators.capacity());
                size_t operator_id = flat_operators.size();
                flat_operators.push_back(std::move(iter->second));
                flat_operators.back().operator_id = operator_id;
                for (auto& child : flat_operators.back().child_operators) {
                    child.parent_operator_id = operator_id;
                }
                mapped.erase(iter);
            }
            size_t child_count = flat_operators.size() - children_begin;
            FlatOperatorNode flat{std::move(op)};
            flat.child_operators = {flat_operators.data() + children_begin, child_count};

            // Register flat operator
            mapped.insert({&op, std::move(flat)});
            pending.pop_back();
        } else {
            current.visited = true;

            // Add the children
            auto& children = op.child_operators.CastUnsafeAs<ParsedOperatorNode>();
            size_t children_begin = pending.size();
            for (auto& child : children) {
                pending.push_back(OperatorDFSNode{
                    .op = child,
                    .visited = false,
                });
            }
            // Reverse the pending items since we're using a DFS stack
            std::reverse(pending.begin() + children_begin, pending.end());
        }
    }

    // Now the map should only contain root operators
    assert(mapped.size() == root_operators.size());
    flat_root_operators.reserve(mapped.size());
    for (auto& [k, v] : mapped) {
        uint32_t oid = flat_operators.size();
        flat_operators.emplace_back(std::move(v));
        flat_operators.back().operator_id = oid;
        flat_root_operators.push_back(oid);
    }
}

size_t PlanViewModel::StringDictionary::Allocate(std::string&& s) {
    if (auto iter = string_ids.find(s); iter != string_ids.end()) {
        return iter->second;
    } else {
        size_t id = strings.GetSize();
        auto& stable = strings.PushBack(std::move(s));
        string_ids.insert({stable, id});
        return id;
    }
}

PlanViewModel::FlatOperatorNode::FlatOperatorNode(ParsedOperatorNode&& parsed)
    : operator_type(parsed.operator_type),
      parent_path(std::move(parsed.parent_child_path)),
      json_value(parsed.json_value),
      child_operators(),
      operator_attributes(std::move(parsed.operator_attributes)) {
    // Construct the attribute map
    operator_attribute_map.reserve(operator_attributes.size());
    for (auto& [k, v] : operator_attributes) {
        operator_attribute_map.insert({k, v});
    }
};

PlanViewModel::FlatOperatorNode::FlatOperatorNode(const FlatOperatorNode& other)
    : operator_type(other.operator_type),
      operator_id(other.operator_id),
      parent_path(other.parent_path),
      json_value(other.json_value),
      child_operators(other.child_operators),
      operator_attributes(other.operator_attributes),
      operator_attribute_map(other.operator_attribute_map) {}

PlanViewModel::FlatOperatorNode::FlatOperatorNode(FlatOperatorNode&& other)
    : operator_type(other.operator_type),
      operator_id(other.operator_id),
      parent_path(std::move(other.parent_path)),
      json_value(other.json_value),
      child_operators(other.child_operators),
      operator_attributes(std::move(other.operator_attributes)),
      operator_attribute_map(std::move(other.operator_attribute_map)) {}

std::string PlanViewModel::FlatOperatorNode::SerializeParentPath() const {
    std::stringstream ss;
    for (size_t i = 0; i < parent_path.size(); ++i) {
        auto& component = parent_path[i];
        std::visit(
            [&](const auto& ctx) -> void {
                using T = std::decay_t<decltype(ctx)>;
                if constexpr (std::is_same_v<T, MemberInObject>) {
                    if (i > 0) {
                        ss << ".";
                    }
                    ss << ctx.attribute;
                } else if constexpr (std::is_same_v<T, EntryInArray>) {
                    ss << "[" << ctx.index << "]";
                }
            },
            component);
    }
    return ss.str();
}

buffers::view::PlanOperator PlanViewModel::FlatOperatorNode::Pack(flatbuffers::FlatBufferBuilder& builder,
                                                                  const PlanViewModel& view_model,
                                                                  StringDictionary& strings) const {
    buffers::view::PlanOperator op;
    op.mutate_operator_id(operator_id);
    op.mutate_operator_type_name(strings.Allocate(operator_type));
    op.mutate_parent_operator_id(parent_operator_id.value_or(std::numeric_limits<uint32_t>::max()));
    op.mutate_parent_path(strings.Allocate(SerializeParentPath()));
    op.mutate_children_begin(child_operators.data() - view_model.flat_operators.data());
    op.mutate_children_count(child_operators.size());
    return op;
}

flatbuffers::Offset<buffers::view::PlanViewModel> PlanViewModel::Pack(flatbuffers::FlatBufferBuilder& builder) const {
    // Track strings in a dictionary for flabuffer
    StringDictionary dictionary;

    // Pack plan operators
    std::vector<buffers::view::PlanOperator> ops;
    ops.reserve(flat_operators.size());
    for (auto& op : flat_operators) {
        ops.push_back(op.Pack(builder, *this, dictionary));
    }
    auto flat_ops_ofs = builder.CreateVectorOfStructs(ops);
    auto flat_roots_ofs = builder.CreateVector(flat_root_operators);
    auto dictionary_strings = ChunkBuffer<std::string>::Flatten(std::move(dictionary.strings));
    auto string_dictionary_ofs = builder.CreateVectorOfStrings(dictionary_strings);

    buffers::view::PlanViewModelBuilder vm{builder};
    vm.add_string_dictionary(string_dictionary_ofs);
    vm.add_operators(flat_ops_ofs);
    vm.add_root_operators(flat_roots_ofs);

    return vm.Finish();
}

}  // namespace dashql
