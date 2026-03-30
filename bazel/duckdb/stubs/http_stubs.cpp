// Stub implementations for DuckDB HTTP utilities.
// HTTP is NOT implemented in this build. All methods throw.

#include "duckdb/common/http_util.hpp"
#include "duckdb/common/exception.hpp"

#define HTTP_NOT_IMPLEMENTED throw duckdb::NotImplementedException("HTTP is not supported in this build")

namespace duckdb {

HTTPParams::~HTTPParams() = default;
void HTTPParams::Initialize(optional_ptr<FileOpener> opener) { HTTP_NOT_IMPLEMENTED; }

HTTPHeaders::HTTPHeaders(DatabaseInstance &db) {}
void HTTPHeaders::Insert(string key, string value) { HTTP_NOT_IMPLEMENTED; }
bool HTTPHeaders::HasHeader(const string &key) const { HTTP_NOT_IMPLEMENTED; }
string HTTPHeaders::GetHeaderValue(const string &key) const { HTTP_NOT_IMPLEMENTED; }

HTTPResponse::HTTPResponse(HTTPStatusCode code) : status(code) {}
bool HTTPResponse::HasHeader(const string &key) const { HTTP_NOT_IMPLEMENTED; }
string HTTPResponse::GetHeaderValue(const string &key) const { HTTP_NOT_IMPLEMENTED; }
bool HTTPResponse::Success() const { HTTP_NOT_IMPLEMENTED; }
bool HTTPResponse::HasRequestError() const { HTTP_NOT_IMPLEMENTED; }
const string &HTTPResponse::GetRequestError() const { HTTP_NOT_IMPLEMENTED; }
const string &HTTPResponse::GetError() const { HTTP_NOT_IMPLEMENTED; }
bool HTTPResponse::ShouldRetry() const { HTTP_NOT_IMPLEMENTED; }

BaseRequest::BaseRequest(RequestType type, const string &url, const HTTPHeaders &headers, HTTPParams &params)
    : type(type), url(url), headers(headers), params(params) {}

HTTPUtil::HTTPUtil() = default;

HTTPUtil &HTTPUtil::Get(DatabaseInstance &db) {
    static HTTPUtil instance;
    return instance;
}

bool HTTPUtil::IsHTTPProtocol(const string &url) {
    return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

void HTTPUtil::BumpToSecureProtocol(string &url) { HTTP_NOT_IMPLEMENTED; }
unique_ptr<HTTPResponse> HTTPUtil::Request(BaseRequest &request) { HTTP_NOT_IMPLEMENTED; }
string HTTPUtil::GetName() const { HTTP_NOT_IMPLEMENTED; }
unique_ptr<HTTPParams> HTTPUtil::InitializeParameters(DatabaseInstance &db, const string &path) { HTTP_NOT_IMPLEMENTED; }
unique_ptr<HTTPParams> HTTPUtil::InitializeParameters(ClientContext &context, const string &path) { HTTP_NOT_IMPLEMENTED; }
unique_ptr<HTTPParams> HTTPUtil::InitializeParameters(optional_ptr<FileOpener> opener, optional_ptr<FileOpenerInfo> info) { HTTP_NOT_IMPLEMENTED; }
unique_ptr<HTTPClient> HTTPUtil::InitializeClient(HTTPParams &params, const string &proto_host_port) { HTTP_NOT_IMPLEMENTED; }
unique_ptr<HTTPResponse> HTTPUtil::SendRequest(BaseRequest &request, unique_ptr<HTTPClient> &client) { HTTP_NOT_IMPLEMENTED; }
void HTTPUtil::LogRequest(BaseRequest &request, optional_ptr<HTTPResponse> response) { HTTP_NOT_IMPLEMENTED; }

}  // namespace duckdb
