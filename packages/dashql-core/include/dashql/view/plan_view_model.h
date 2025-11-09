#pragma once

#include <variant>

#include "dashql/buffers/index_generated.h"
#include "dashql/utils/btree/map.h"
#include "dashql/utils/chunk_buffer.h"
#include "dashql/utils/intrusive_list.h"
#include "flatbuffers/flatbuffer_builder.h"
#include "rapidjson/document.h"

namespace dashql {

class PlanLayouter;
struct PlanLayoutNode;

class PlanViewModel {
    friend class ::dashql::PlanLayouter;
    friend class ::dashql::PlanLayoutNode;

   public:
    /// A string dictionary
    struct StringDictionary {
        /// The allocated strings
        ChunkBuffer<std::string> strings;
        /// The string ids
        std::unordered_map<std::string_view, size_t> string_ids;

        /// Allocate a string in the string dictionary
        size_t Allocate(std::string&& s);
        /// Allocate a string in the string dictionary
        size_t Allocate(std::string_view s) { return Allocate(std::string{s}); }
    };
    /// An child attribute in another object
    struct MemberInObject {
        /// The parent index
        size_t object_node;
        /// The attribute name
        std::string_view attribute;
        /// Constructor
        MemberInObject(size_t parent_index, std::string_view name) : object_node(parent_index), attribute(name) {}
    };
    /// An entry in an array
    struct EntryInArray {
        /// The parent index
        size_t array_node;
        /// The index in the array
        size_t index;
        /// Constructor
        EntryInArray(size_t parent_index, size_t index) : array_node(parent_index), index(index) {}
    };
    /// A path component
    using PathComponent = std::variant<MemberInObject, EntryInArray, std::monostate>;
    /// The node
    struct ParsedOperatorNode : public IntrusiveListNode {
        /// The parent child type
        std::vector<PathComponent> parent_child_path;
        /// The json value
        rapidjson::Value& json_value;
        /// The operator type
        std::optional<std::string_view> operator_type;
        /// The operator label
        std::optional<std::string_view> operator_label;
        /// The child operators
        IntrusiveList<IntrusiveListNode> child_operators;
        /// The operator attributes
        std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> operator_attributes;
        /// The source location
        std::optional<dashql::buffers::parser::Location> source_location;

        /// Constructor
        ParsedOperatorNode(
            std::vector<PathComponent> parent_child_path, rapidjson::Value& json_value,
            std::optional<std::string_view> operator_type, std::optional<std::string_view> operator_label,
            IntrusiveList<IntrusiveListNode> children,
            std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> attributes,
            std::optional<dashql::buffers::parser::Location> source_location)
            : parent_child_path(std::move(parent_child_path)),
              json_value(json_value),
              operator_type(operator_type),
              operator_label(operator_label),
              child_operators(children),
              operator_attributes(std::move(attributes)),
              source_location(source_location) {}
    };
    /// A fragment
    struct Fragment {};
    /// A pipeline.
    /// Note that a pipeline does not need to to be linear.
    /// Hyper implements a Fork operator that will effectively result in two pipeline targets.
    struct Pipeline {
        /// The fragment id
        uint32_t fragment_id = 0;
        /// The pipeline id
        uint32_t pipeline_id = 0;
        /// The edges in the pipeline
        btree::map<std::pair<size_t, size_t>, buffers::view::PlanPipelineEdge> edges;

        /// Pack a pipeline
        buffers::view::PlanPipeline Pack(flatbuffers::FlatBufferBuilder& builder, const PlanViewModel& viewModel,
                                         StringDictionary& strings) const;
    };
    struct OperatorNode;
    /// An operator edge
    struct OperatorEdge {
        /// The edge id
        uint32_t edge_id = 0;
        /// The pipeline (if assigned)
        std::optional<std::reference_wrapper<Pipeline>> pipeline;
        /// The parent operator
        OperatorNode& parent_operator;
        /// The child operator
        OperatorNode& child_operator;
        /// The port count of the parent
        size_t parent_port_count = 0;
        /// The port id in the parent where this edge ends
        size_t parent_port_index = 0;

        /// Pack an edge
        buffers::view::PlanOperatorEdge Pack(flatbuffers::FlatBufferBuilder& builder, const PlanViewModel& viewModel,
                                             StringDictionary& strings) const;
    };
    /// A sealed operator node
    struct OperatorNode {
        /// The operator id
        uint32_t operator_id = 0;
        /// The operator type
        std::optional<std::string_view> operator_type;
        /// The operator label
        std::optional<std::string_view> operator_label;
        /// The parent operator id
        std::optional<size_t> parent_operator_id;
        /// The parent path
        std::vector<PathComponent> parent_path;
        /// The source location
        std::optional<dashql::buffers::parser::Location> source_location;
        /// The json value
        rapidjson::Value& json_value;
        /// The child operators
        std::span<OperatorNode> child_operators;
        /// The child edges
        std::span<OperatorEdge> child_edges;
        /// The layout info
        std::optional<buffers::view::PlanLayoutRect> layout_rect;

        /// The operator attributes
        std::vector<std::pair<std::string_view, std::reference_wrapper<const rapidjson::Value>>> operator_attributes;
        /// The operator attribute map
        std::unordered_map<std::string_view, std::reference_wrapper<const rapidjson::Value>> operator_attribute_map;
        /// The inbound pipelines in the order they are produced
        std::vector<std::reference_wrapper<Pipeline>> inbound_pipelines;
        /// The outbound pipelines in the order they are produced
        std::vector<std::reference_wrapper<Pipeline>> outbound_pipelines;

        // Construct from parsed node
        OperatorNode(ParsedOperatorNode&& parsed);
        // Copy constructor (Wasm needs an explicit one)
        OperatorNode(const OperatorNode& other);
        // Move constructor
        OperatorNode(OperatorNode&& other);

        /// Serialize the parent child path
        std::string SerializeParentPath() const;
        /// Pack a plan operator
        buffers::view::PlanOperator Pack(flatbuffers::FlatBufferBuilder& builder, const PlanViewModel& viewModel,
                                         StringDictionary& strings) const;
    };

   protected:
    /// The input json plan.
    /// We use destructive parsing, so this will not be valid json
    std::unique_ptr<char[]> input_buffer;
    /// The document
    rapidjson::Document document;
    /// The operators
    std::vector<OperatorNode> operators;
    /// The operator edges
    std::vector<OperatorEdge> operator_edges;
    /// The root operators
    std::vector<uint32_t> root_operators;
    /// The pipelines
    ChunkBuffer<Pipeline> pipelines;
    /// The fragments
    std::vector<Fragment> fragments;
    /// The layout config
    buffers::view::DerivedPlanLayoutConfig layout_config;
    /// The layout info of the entire plan
    std::optional<buffers::view::PlanLayoutRect> layout_rect;

    /// Register a pipeline
    Pipeline& RegisterPipeline();
    /// Flatten the operators
    void FlattenOperators(ChunkBuffer<ParsedOperatorNode>&& ops,
                          std::vector<std::reference_wrapper<ParsedOperatorNode>>&& roots);
    /// Identify the operators edges
    void IdentifyOperatorEdges(std::span<OperatorNode> ops, size_t child_edge_count);
    /// Identify Hyper pipelines
    void IdentifyHyperPipelines();

   public:
    /// Constructor
    PlanViewModel();

    /// Reset the entire view model
    void Reset();
    /// Reset the view model execution
    void ResetExecution();
    /// Parse a hyper plan
    buffers::status::StatusCode ParseHyperPlan(std::string_view plan, std::unique_ptr<char[]> plan_buffer = nullptr);
    /// Configure
    void Configure(const buffers::view::PlanLayoutConfig& layout_config);
    /// Compute the plan layout
    void ComputeLayout();

    /// Pack the plan view model as flatbuffer
    flatbuffers::Offset<buffers::view::PlanViewModel> Pack(flatbuffers::FlatBufferBuilder& builder) const;
};

}  // namespace dashql
