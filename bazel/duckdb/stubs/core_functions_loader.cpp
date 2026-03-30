// Wrapper to expose core_functions LoadInternal as a callable function
#include "duckdb/main/extension/extension_loader.hpp"
#include "core_functions/function_list.hpp"

namespace duckdb {

// This function is called from extension_stubs.cpp to load core_functions
void CoreFunctionsLoadInternal(ExtensionLoader &loader) {
    FunctionList::RegisterExtensionFunctions(loader, CoreFunctionList::GetFunctionList());
}

}  // namespace duckdb
