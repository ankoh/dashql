#include <string_view>
#include <unordered_set>

#include "dashql/buffers/index_generated.h"
#include "dashql/exception.h"
#include "dashql/utils/intrusive_list.h"
#include "dashql/view/plan_view_model.h"
#include "rapidjson/document.h"
#include "rapidjson/rapidjson.h"

namespace dashql {

constexpr unsigned PARSE_FLAGS = rapidjson::ParseFlag::kParseCommentsFlag | rapidjson::ParseFlag::kParseNanAndInfFlag |
                                 rapidjson::ParseFlag::kParseTrailingCommasFlag |
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
    /// The operator type (if any)
    std::optional<std::string_view> operator_type = std::nullopt;
    /// The operator label (if any)
    std::optional<std::string_view> operator_label = std::nullopt;
    /// The operator id serialized by Hyper (if any)
    std::optional<uint64_t> source_operator_id = std::nullopt;
    /// The attributes
    std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> attributes;
    /// The already emitted children
    IntrusiveList<PlanViewModel::ParsedOperatorNode> child_operators;
    /// The source location
    std::optional<dashql::buffers::parser::SymbolSpan> source_location = std::nullopt;

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

void PlanViewModel::ParseHyperPlan(std::string_view plan, std::unique_ptr<char[]> plan_buffer) {
    AncestorPathBuilder path_builder;
    ChunkBuffer<ParsedOperatorNode> parsed_operators;
    // Reset the current plan view model
    Reset();
    // Collect root operators
    std::vector<std::reference_wrapper<ParsedOperatorNode>> root_operators;

    // Store the input before parsing in-situ (the document will hold pointers into this text buffer)
    if (plan_buffer) {
        // User passed us ownership
        input_buffer = std::move(plan_buffer);
    } else {
        // Otherwise copy the plan
        input_buffer = std::make_unique<char[]>(plan.size() + 1);
        std::memcpy(input_buffer.get(), plan.data(), plan.size());
        input_buffer[plan.size()] = 0;
    }

    // Parse the document.
    // Note that ParseInsitu is destructive, input will no longer hold valid json afterwards.
    document.ParseInsitu<PARSE_FLAGS>(input_buffer.get());
    if (document.HasParseError()) {
        throw Exception(buffers::status::StatusCode::VIEWMODEL_INPUT_JSON_PARSER_ERROR);
    }

    // Run DFS over the json plan.
    // Perform a post-order DFS over all json nodes.
    // Emit operator nodes on our way up and resolve the lowest ancestor through the DFS stack.
    std::vector<ParserDFSNode> pending;
    pending.emplace_back(document, std::nullopt, std::monostate{});
    size_t child_edge_count = 0;
    do {
        ParserDFSNode& current = pending.back();
        auto current_index = pending.size() - 1;

        // Already visited?
        if (current.visited) {
            // Is an operator?
            if (current.operator_type.has_value()) {
                // Build the ancestor path
                auto [ancestor, ancestor_path] = path_builder.findAncestor(pending, current_index);
                // Then emit the node
                auto& op = parsed_operators.PushBack(PlanViewModel::ParsedOperatorNode{
                    std::move(ancestor_path), std::ref(*current.json_value), current.operator_type, current.operator_label,
                    current.source_operator_id, current.child_operators.CastAsBase(), std::move(current.attributes),
                    current.source_location});
                child_edge_count += current.child_operators.GetSize();
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
                size_t pending_begin = pending.size();
                for (auto iter = o.MemberBegin(); iter != o.MemberEnd(); ++iter) {
                    assert(iter->name.IsString());
                    std::string_view attribute_name{iter->name.GetString()};

                    // Is the current node an operator?
                    if (attribute_name == "operator" && iter->value.IsString()) {
                        // Mark as such and skip attribute during DFS
                        std::string_view operator_type = iter->value.GetString();
                        pending[current_index].operator_type = operator_type;
                    }
                    // Contains an operator id?
                    else if (attribute_name == "operatorId" && iter->value.IsUint64()) {
                        pending[current_index].source_operator_id = iter->value.GetUint64();
                        pending[current_index].attributes.emplace_back(attribute_name, iter->value);
                    }
                    // Contains a debug name?
                    else if (attribute_name == "debugName" && iter->value.IsObject()) {
                        auto debugName = iter->value.GetObject();
                        auto iter = debugName.FindMember("value");
                        if (iter != debugName.MemberEnd() && iter->value.IsString()) {
                            pending[current_index].operator_label = iter->value.GetString();
                        }
                    }
                    // Contains a sqlpos?
                    else if (attribute_name == "sqlpos" && iter->value.IsArray()) {
                        auto sqlPos = iter->value.GetArray();
                        if (!sqlPos.Empty() && sqlPos.Begin()->IsArray() && sqlPos.Begin()->GetArray().Size() == 2) {
                            auto sqlPosArray = sqlPos.Begin()->GetArray();
                            auto iterBegin = sqlPosArray.Begin();
                            auto iterEnd = sqlPosArray.Begin() + 1;
                            auto posBegin = iterBegin->IsNumber() ? iterBegin->GetUint() : 0;
                            auto posEnd = iterEnd->IsNumber() ? iterEnd->GetUint() : 0;
                            pending[current_index].source_location =
                                dashql::buffers::parser::SymbolSpan(posBegin, std::max(posEnd, posBegin) - posBegin);
                        }
                    } else {
                        // Remember as attribute
                        pending[current_index].attributes.emplace_back(attribute_name, iter->value);
                        // Mark pending for DFS traversal
                        pending.emplace_back(iter->value, current_index, MemberInObject(current_index, attribute_name));
                    }
                }
                // Reverse the order of the attribute nodes on the stack
                std::reverse(pending.begin() + pending_begin, pending.end());
                break;
            }
            // Current node is an array:
            // - Add children for DFS
            case rapidjson::Type::kArrayType: {
                auto values = current.json_value->GetArray();
                for (size_t i = values.Size(); i > 0; --i) {
                    size_t j = i - 1;
                    auto& child_value = values[j];
                    pending.emplace_back(child_value, current_index, EntryInArray(current_index, j));
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

    // Create default fragment
    // XXX
    fragments.emplace_back();

    // Flatten the Hyper operators
    FlattenOperators(std::move(parsed_operators), std::move(root_operators));
    // Identify the operator edges
    IdentifyOperatorEdges(operators, child_edge_count);
    // Read pipelines if this plan format provides them. Legacy plans render without pipeline overlays.
    ParseHyperPipelines();
}

void PlanViewModel::IdentifyOperatorEdges(std::span<OperatorNode> ops, size_t child_edge_count) {
    std::vector<OperatorEdge> child_edges;
    child_edges.reserve(child_edge_count);
    for (auto& parent : operators) {
        size_t child_count = parent.children_count;
        size_t edges_begin = child_edges.size();
        for (size_t child_id = 0; child_id < parent.children_count; ++child_id) {
            auto& child = operators[parent.children_begin + child_id];
            assert(child_edges.size() < child_edges.capacity());
            child_edges.push_back(
                PlanViewModel::OperatorEdge{static_cast<uint32_t>(child_edges.size()), std::nullopt, parent, child, child_count, child_id});
        }
        parent.child_edges = {child_edges.data() + edges_begin, child_edges.size() - edges_begin};
    }
    operator_edges = std::move(child_edges);
}

void PlanViewModel::ParseHyperPipelines() {
    if (!document.IsObject()) return;
    auto pipelines_iter = document.FindMember("pipelines");
    if (pipelines_iter == document.MemberEnd() || !pipelines_iter->value.IsArray()) return;

    std::unordered_map<uint64_t, uint32_t> operator_ids;
    for (auto& op : operators) {
        if (op.source_operator_id.has_value()) operator_ids.emplace(*op.source_operator_id, op.operator_id);
    }

    uint64_t next_edge_id = 0;
    for (auto& source_pipeline : pipelines_iter->value.GetArray()) {
        if (!source_pipeline.IsObject()) continue;
        auto source = source_pipeline.GetObject();
        std::optional<uint64_t> source_pipeline_id;
        if (auto id = source.FindMember("pipelineId"); id != source.MemberEnd() && id->value.IsUint64()) {
            source_pipeline_id = id->value.GetUint64();
        }
        auto& pipeline = RegisterPipeline(source_pipeline_id);
        if (auto fragment = source.FindMember("fragmentId");
            fragment != source.MemberEnd() && fragment->value.IsUint()) {
            pipeline.fragment_id = fragment->value.GetUint();
        }

        auto members = source.FindMember("operators");
        if (members == source.MemberEnd() || !members->value.IsArray()) continue;
        for (auto& source_operator : members->value.GetArray()) {
            if (!source_operator.IsUint64()) continue;
            auto mapped = operator_ids.find(source_operator.GetUint64());
            if (mapped != operator_ids.end()) pipeline.operators.push_back(mapped->second);
        }

        std::unordered_set<uint32_t> membership(pipeline.operators.begin(), pipeline.operators.end());
        for (auto& edge : operator_edges) {
            if (!membership.contains(edge.child_operator.operator_id) ||
                !membership.contains(edge.parent_operator.operator_id)) {
                continue;
            }
            pipeline.edges.emplace_back(next_edge_id++, pipeline.pipeline_id, edge.child_operator.operator_id,
                                        edge.parent_operator.operator_id, false);
            edge.pipeline = pipeline;
        }
    }
}

}  // namespace dashql
