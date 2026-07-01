#pragma once

#include <span>
#include <vector>

#include "dashql/analyzer/analyzer_types.h"
#include "dashql/analyzer/pass_manager.h"
#include "dashql/buffers/index_generated.h"

namespace dashql {

struct AnalysisState;

struct AnalyzeVisualizationPass : public PassManager::LTRPass {
   protected:
    struct NodeState {
        /// Encoding channels collected from child field defs
        std::vector<VisEncodingChannel> encoding_channels;
        /// Mark type found in child
        std::optional<buffers::parser::VisMarkType> mark_type;
        /// Structured mark definition found in child (object form)
        std::optional<VisMark> mark;
        /// Top-level title
        std::optional<std::string_view> title;
        /// Top-level width
        std::optional<int64_t> width;
        /// Top-level height
        std::optional<int64_t> height;
        /// Scale/axis/legend propagated from level 4 up to level 3
        std::optional<VisScale> scale;
        std::optional<VisAxis> axis;
        std::optional<VisLegend> legend;

        void Clear();
        void MergeFrom(NodeState&& other);
    };

    /// Per-node state
    std::vector<NodeState> node_states;
    /// Collected specs
    std::vector<VisualizationSpec> collected_specs;

    /// Merge child states into a destination
    void MergeChildStates(NodeState& dst, const buffers::parser::Node& parent);

   public:
    AnalyzeVisualizationPass(AnalysisState& state);

    void Prepare() override;
    void Visit(std::span<const buffers::parser::Node> morsel) override;
    void Finish() override;
};

}  // namespace dashql
