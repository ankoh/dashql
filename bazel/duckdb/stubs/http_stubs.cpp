// Stub implementations for DuckDB HTTP utilities
// These are needed when HTTP source files are excluded from the build

#include "duckdb/common/http_util.hpp"
#include "duckdb/common/exception.hpp"

namespace duckdb {

// HTTPParams
HTTPParams::~HTTPParams() = default;

void HTTPParams::Initialize(optional_ptr<FileOpener> opener) {
    // No-op stub
}

// HTTPHeaders
HTTPHeaders::HTTPHeaders(DatabaseInstance &db) {
    // No-op stub
}

void HTTPHeaders::Insert(string key, string value) {
    headers[std::move(key)] = std::move(value);
}

bool HTTPHeaders::HasHeader(const string &key) const {
    return headers.find(key) != headers.end();
}

string HTTPHeaders::GetHeaderValue(const string &key) const {
    auto it = headers.find(key);
    return it != headers.end() ? it->second : string();
}

// HTTPResponse
HTTPResponse::HTTPResponse(HTTPStatusCode code) : status(code) {
}

bool HTTPResponse::HasHeader(const string &key) const {
    return headers.HasHeader(key);
}

string HTTPResponse::GetHeaderValue(const string &key) const {
    return headers.GetHeaderValue(key);
}

bool HTTPResponse::Success() const {
    return success;
}

bool HTTPResponse::HasRequestError() const {
    return !request_error.empty();
}

const string &HTTPResponse::GetRequestError() const {
    return request_error;
}

const string &HTTPResponse::GetError() const {
    return HasRequestError() ? request_error : reason;
}

bool HTTPResponse::ShouldRetry() const {
    return false;  // Never retry in stub
}

// BaseRequest
BaseRequest::BaseRequest(RequestType type, const string &url, const HTTPHeaders &headers, HTTPParams &params)
    : type(type), url(url), headers(headers), params(params) {
}

// HTTPUtil
HTTPUtil::HTTPUtil() = default;

HTTPUtil &HTTPUtil::Get(DatabaseInstance &db) {
    static HTTPUtil instance;
    return instance;
}

bool HTTPUtil::IsHTTPProtocol(const string &url) {
    return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

void HTTPUtil::BumpToSecureProtocol(string &url) {
    if (url.rfind("http://", 0) == 0) {
        url = "https://" + url.substr(7);
    }
}

unique_ptr<HTTPResponse> HTTPUtil::Request(BaseRequest &request) {
    throw NotImplementedException("HTTP requests are not supported in this build");
}

// Virtual method implementations to generate vtable
string HTTPUtil::GetName() const {
    return "http_stub";
}

unique_ptr<HTTPParams> HTTPUtil::InitializeParameters(DatabaseInstance &db, const string &path) {
    throw NotImplementedException("HTTP parameters initialization not supported");
}

unique_ptr<HTTPParams> HTTPUtil::InitializeParameters(ClientContext &context, const string &path) {
    throw NotImplementedException("HTTP parameters initialization not supported");
}

unique_ptr<HTTPParams> HTTPUtil::InitializeParameters(optional_ptr<FileOpener> opener, optional_ptr<FileOpenerInfo> info) {
    throw NotImplementedException("HTTP parameters initialization not supported");
}

unique_ptr<HTTPClient> HTTPUtil::InitializeClient(HTTPParams &params, const string &proto_host_port) {
    throw NotImplementedException("HTTP client initialization not supported");
}

unique_ptr<HTTPResponse> HTTPUtil::SendRequest(BaseRequest &request, unique_ptr<HTTPClient> &client) {
    throw NotImplementedException("HTTP requests not supported");
}

void HTTPUtil::LogRequest(BaseRequest &request, optional_ptr<HTTPResponse> response) {
    // No-op
}

}  // namespace duckdb
