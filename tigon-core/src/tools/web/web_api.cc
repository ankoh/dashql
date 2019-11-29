//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "tigon/tools/web/web_api.h"

#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"

#include "spdlog/spdlog.h"

#include "tigon/parser/tql/tql_parse_context.h"
#include "tigon/proto/duckdb_codec.h"
#include "tigon/proto/tql_codec.h"
#include "tigon/proto/tql.pb.h"
#include "tigon/proto/web_api.pb.h"
#include "tigon/common/variant.h"

#include <cstdio>
#include <memory>
#include <optional>
#include <unordered_map>
#include <string_view>
#include <iostream>

using namespace tigon;

/// Reset the response
void WebAPI::Response::clear() {
    status_code = proto::web_api::StatusCode::SUCCESS;
    error.clear();
    data = {};
}

/// Write the packed response
void WebAPI::Response::writePacked(WebAPI::Response::Packed& packed) {
    packed.error = error.empty() ? 0 : reinterpret_cast<uintptr_t>(error.data());
    packed.data = reinterpret_cast<uintptr_t>(data.data());
    packed.data_size = data.size();
    packed.status_code = static_cast<uint32_t>(status_code);
}

/// Request succeeded
void WebAPI::Response::requestSucceeded(nonstd::span<std::byte> d) {
    clear();
    status_code = proto::web_api::StatusCode::SUCCESS;
    data = d;
}

void WebAPI::Response::requestFailed(proto::web_api::StatusCode status, std::string err) {
    clear();
    status_code = status;
    error = move(err);
}

/// Constructor
WebAPI::Response::Response(WebAPI::Session &session)
    : session(session), status_code(), error(), data() {}

/// Constructor
WebAPI::Response::~Response() {
    clear();
}

/// Constructor
WebAPI::Session::Session(std::shared_ptr<duckdb::DuckDB> database)
    : database(std::move(database)), buffers(), response(*this), nextQueryID() {}

/// Destructor
WebAPI::Session::~Session() {}

/// Write the packed response
void WebAPI::Session::writePackedResponse(Response::Packed& packed) {
    response.writePacked(packed);
}

/// Encode a message
nonstd::span<std::byte> WebAPI::Session::serializeMessage(google::protobuf::MessageLite& msg) {
    // Serialize the message
    auto size = msg.ByteSizeLong();
    auto bytes = std::unique_ptr<std::byte[]>(new std::byte[size]);
    msg.SerializeToArray(bytes.get(), size);

    // Register the buffer
    return registerBuffer(std::move(bytes), size);
}

/// Register a buffer
nonstd::span<std::byte> WebAPI::Session::registerBuffer(std::unique_ptr<std::byte[]> data, size_t dataSize) {
    Buffer buffer{std::move(data), dataSize};
    auto span = buffer.asSpan();
    auto ptr = span.data();
    buffers.insert({ptr, std::move(buffer)});
    return span;
}

/// Release a buffer
void WebAPI::Session::releaseBuffer(void* data) {
    buffers.erase(data);
}

/// Parse TQL
void WebAPI::Session::parseTQL(std::string_view text) {
    // Parse statement
    tql::ParseContext ctx;
    auto module = ctx.Parse(text);

    // Encode the tql module
    google::protobuf::Arena arena;
    auto msg = encodeTQLModule(arena, module);
    auto buffer = serializeMessage(*msg);

    // Return buffer
    response.requestSucceeded(buffer);
}

/// Run a query
void WebAPI::Session::runQuery(std::string_view text) {
    auto queryID = allocateQueryID();

    // Create a new connection
    duckdb::Connection conn{*database};
    auto result = conn.SendQuery(std::string{text});

    // Query failed?
    if (!result->success) {
        response.requestFailed(proto::web_api::StatusCode::ERROR, result->error);
        return;
    }

    // Encode the result
    google::protobuf::Arena arena;
    auto msg = encodeQueryResult(arena, *result, queryID);
    auto buffer = serializeMessage(*msg);

    // Return buffer
    response.requestSucceeded(buffer);
}

/// Plan a sql statement
void WebAPI::Session::planQuery(std::string_view text) {
    // Parse the statements
    duckdb::Connection conn{*database};
    duckdb::Parser parser(*conn.context);
    parser.ParseQuery(std::string(text));

    // Begin transaction
    conn.context->transaction.BeginTransaction();

    // Invalid statement count?
    if (parser.statements.size() != 1) {
        spdlog::warn("invalid number of statements");
        return;
    }

    // Plan the query
    duckdb::Planner planner{*conn.context};
    planner.CreatePlan(move(*parser.statements.begin()));
    conn.context->transaction.Rollback();

    // Encode the query plan
    google::protobuf::Arena arena;
    auto msg = encodeQueryPlan(arena, *planner.plan);
    auto buffer = serializeMessage(*msg);

    // Return buffer
    response.requestSucceeded(buffer);
}

/// Constructor
WebAPI::WebAPI()
    : database(std::make_shared<duckdb::DuckDB>()), sessions() {}

/// Create a session
WebAPI::Session& WebAPI::createSession() {
    auto session = std::make_unique<WebAPI::Session>(database);
    auto sessionPtr = session.get();
    sessions.insert({sessionPtr, move(session)});
    return *sessionPtr;
}

/// End a session
void WebAPI::endSession(Session* session) {
    sessions.erase(session);
}

namespace {

// Taken from bithacks.
// Interleave bits by Binary Magic Numbers
// http://graphics.stanford.edu/~seander/bithacks.html
uint32_t computeZCurvePosition(uint16_t xIn, uint16_t yIn) {
    static const uint32_t B[] = {0x55555555, 0x33333333, 0x0F0F0F0F, 0x00FF00FF};
    static const uint32_t S[] = {1, 2, 4, 8};

    // Interleave lower 16 bits of x and y, so the bits of x
    // are in the even positions and bits from y in the odd;
    // z gets the resulting 32-bit Morton Number. 
    // x and y must initially be less than 65536.
    uint32_t x = xIn;
    uint32_t y = yIn;
    uint32_t z;      

    x = (x | (x << S[3])) & B[3];
    x = (x | (x << S[2])) & B[2];
    x = (x | (x << S[1])) & B[1];
    x = (x | (x << S[0])) & B[0];

    y = (y | (y << S[3])) & B[3];
    y = (y | (y << S[2])) & B[2];
    y = (y | (y << S[1])) & B[1];
    y = (y | (y << S[0])) & B[0];

    z = x | (y << 1);
    return z;
}

struct PositionedElement {
    uint32_t zPos;
    uint16_t xBegin;
    uint16_t xEnd;
    uint16_t yBegin;
    uint16_t yEnd;

    PositionedElement(uint32_t zPos, uint16_t xBegin, uint16_t xEnd, uint16_t yBegin, uint16_t yEnd)
        : zPos(zPos), xBegin(xBegin), xEnd(xEnd), yBegin(yBegin), yEnd(yEnd) {}
};

}

/// Compute a grid layout
void WebAPI::computeGridLayout(nonstd::span<GridElement> elements) {
    std::vector<PositionedElement> elems;
    size_t columnCount = 12;
    size_t allocatedRows;

    // Separate elements that have been elems already
    elems.reserve(elements.size());
    for (auto& elem: elements) {
        auto width = elem.width + elem.offsetX;
        auto height = elem.height + elem.offsetY;

        for (size_t yBegin = 0; yBegin < allocatedRows;) {
            for (size_t xBegin = 0; xBegin + width <= columnCount;) {
                auto xEnd = xBegin + width;
                auto yEnd = yBegin + height;

                // Search candidates
                auto anchorNW = computeZCurvePosition(xBegin, yBegin);
                auto anchorSE = computeZCurvePosition(xEnd, yEnd);
                auto lb = elems.begin() + (elems.rend() - std::lower_bound(elems.rbegin(), elems.rend(), anchorNW, [](auto& e, auto v) {
                    return e.zPos > v;
                }));
                auto ub = std::lower_bound(elems.begin(), elems.end(), anchorSE, [](auto& e, auto v) {
                    return e.zPos < v;
                });

                // Check iterators
                bool foundConflict = false;
                auto xMax = 0, yMax = 0;
                for (auto iter = lb; iter < ub; ++iter) {
                    auto& candidate = *iter;
                    auto xOverlaps = !(xEnd <= candidate.xBegin || xBegin >= candidate.xEnd);
                    auto yOverlaps = !(yEnd <= candidate.yBegin || yBegin >= candidate.yBegin);
                    if (xOverlaps || yOverlaps) {
                        foundConflict = true;
                        xMax = std::max<uint16_t>(xMax, candidate.xEnd);
                        yMax = std::max<uint16_t>(yMax, candidate.yEnd);
                        break;
                    }
                }

                if (!foundConflict) {
                    // TODO found something
                }

                // Advance iterators
                xBegin = xMax;
                yBegin = yMax;
            }
        }

        // TODO adjust elements
        // auto pos = computeZCurvePosition(elem.offsetX, elem.offsetY);
        // elems.emplace_back(pos, elem.width, elem.height, elem.offsetX, elem.offsetY);
    }
}
