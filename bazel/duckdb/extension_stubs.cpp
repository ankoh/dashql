// Stub implementations for DuckDB extension functions
// These are needed when extension loading is disabled

#include "duckdb/main/extension_helper.hpp"
#include "duckdb/main/database.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/common/file_system.hpp"
#include "duckdb/common/exception.hpp"

namespace duckdb {

void ExtensionHelper::LoadAllExtensions(DuckDB &db) {
    // No-op stub - no extensions loaded in minimal build
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

}  // namespace duckdb
