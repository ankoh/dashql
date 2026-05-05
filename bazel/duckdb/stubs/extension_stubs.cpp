// Stub implementations for DuckDB extension functions
// These are needed when external extension loading is disabled

#include "duckdb/main/extension_helper.hpp"
#include "duckdb/main/database.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/common/exception.hpp"
#include "duckdb/main/extension_manager.hpp"
#include "duckdb/main/extension_install_info.hpp"
#include "duckdb/main/extension/extension_loader.hpp"
#include "icu_extension.hpp"

namespace duckdb {

// Forward declaration from core_functions extension
void CoreFunctionsLoadInternal(ExtensionLoader &loader);

static void LoadStaticExtension(ExtensionManager &manager, const string &name,
                                 std::function<void(ExtensionLoader &)> load_fn) {
    auto handle = manager.BeginLoad(name);
    if (!handle) {
        return;
    }
    ExtensionLoader loader(*handle);
    load_fn(loader);
    ExtensionInstallInfo info;
    info.mode = ExtensionInstallMode::STATICALLY_LINKED;
    handle->FinishLoad(info);
}

void ExtensionHelper::LoadAllExtensions(DuckDB &db) {
    auto &extension_manager = db.instance->GetExtensionManager();

    LoadStaticExtension(extension_manager, "core_functions", CoreFunctionsLoadInternal);

    LoadStaticExtension(extension_manager, "icu", [](ExtensionLoader &loader) {
        IcuExtension ext;
        ext.Load(loader);
    });
}

unique_ptr<ExtensionInstallInfo> ExtensionHelper::InstallExtension(ClientContext &context, const string &extension, ExtensionInstallOptions &options) {
    throw NotImplementedException("Extension installation not supported in this build");
}

unique_ptr<ExtensionInstallInfo> ExtensionHelper::InstallExtension(DatabaseInstance &db, FileSystem &fs, const string &extension, ExtensionInstallOptions &options) {
    throw NotImplementedException("Extension installation not supported in this build");
}

void ExtensionHelper::LoadExternalExtension(ClientContext &context, const string &extension) {
    throw NotImplementedException("Extension loading not supported in this build");
}

void ExtensionHelper::LoadExternalExtension(DatabaseInstance &db, FileSystem &fs, const string &extension) {
    throw NotImplementedException("Extension loading not supported in this build");
}

string ExtensionHelper::ExtensionDirectory(DatabaseInstance &db, FileSystem &fs) {
    return "";
}

ParsedExtensionMetaData ExtensionHelper::ParseExtensionMetaData(FileHandle &handle) {
    throw NotImplementedException("Extension metadata parsing not supported in this build");
}

string ExtensionHelper::GetExtensionName(const string &extension) {
    return extension;
}

bool ExtensionHelper::IsFullPath(const string &extension) {
    return false;
}

string ExtensionHelper::ExtractExtensionPrefixFromPath(const string &path) {
    return "";
}

vector<string> ExtensionHelper::GetExtensionDirectoryPath(ClientContext &context) {
    return vector<string>();
}

const string ExtensionHelper::GetVersionDirectoryName() {
    return "";
}

bool ExtensionHelper::IsRelease(const string &version_tag) {
    return false;
}

}  // namespace duckdb
