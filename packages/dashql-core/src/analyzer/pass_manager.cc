#include "dashql/analyzer/pass_manager.h"

namespace dashql {

/// Destructor
PassManager::LTRPass::~LTRPass() {}
/// Destructor
PassManager::RTLPass::~RTLPass() {}

/// Constructor
PassManager::PassManager(ParsedScript& parser) : parsedProgram(parser) {}
/// Execute DFS post-order passes
void PassManager::Execute(std::initializer_list<std::reference_wrapper<LTRPass>> passes) {
    // Prepare all passes
    for (auto& pass : passes) {
        pass.get().Prepare();
    }
    // Scan all nodes
    auto iter = 0;
    while (iter != parsedProgram.nodes.size()) {
        size_t morsel_size = std::min<size_t>(parsedProgram.nodes.size() - iter, 1024);
        for (auto& pass : passes) {
            pass.get().Visit(std::span<buffers::parser::Node>(parsedProgram.nodes).subspan(iter, morsel_size));
        }
        iter += morsel_size;
    }
    // Finish all passes
    for (auto& pass : passes) {
        pass.get().Finish();
    }
}

}  // namespace dashql
