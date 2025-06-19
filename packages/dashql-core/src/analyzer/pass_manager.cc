#include "dashql/analyzer/pass_manager.h"

#include "dashql/analyzer/analyzer.h"

namespace dashql {

/// Constructor
PassManager::LTRPass::LTRPass(AnalyzerState& state) : state(state) {}
/// Destructor
PassManager::LTRPass::~LTRPass() {}

/// Constructor
PassManager::RTLPass::RTLPass(AnalyzerState& state) : state(state) {}
/// Destructor
PassManager::RTLPass::~RTLPass() {}

/// Constructor
PassManager::PassManager() {}
/// Execute DFS post-order passes
void PassManager::Execute(AnalyzerState& state, std::initializer_list<std::reference_wrapper<LTRPass>> passes) {
    // Prepare all passes
    for (auto& pass : passes) {
        pass.get().Prepare();
    }
    // Scan all nodes
    auto iter = 0;
    while (iter != state.ast.size()) {
        size_t morsel_size = std::min<size_t>(state.ast.size() - iter, 1024);
        for (auto& pass : passes) {
            pass.get().Visit(state.ast.subspan(iter, morsel_size));
        }
        iter += morsel_size;
    }
    // Finish all passes
    for (auto& pass : passes) {
        pass.get().Finish();
    }
}

}  // namespace dashql
