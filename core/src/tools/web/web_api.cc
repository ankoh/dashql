//---------------------------------------------------------------------------
// DashQL
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#include "dashql/tools/web/web_api.h"

#include "duckdb.hpp"
#include "duckdb/common/vector_operations/vector_operations.hpp"
#include "duckdb/main/client_context.hpp"
#include "duckdb/parallel/task_scheduler.hpp"
#include "duckdb/parser/parser.hpp"
#include "duckdb/planner/planner.hpp"

#include "spdlog/spdlog.h"

#include "dashql/common/variant.h"
#include "dashql/parser/tql/tql_parse_context.h"
#include "dashql/proto/duckdb_codec.h"
#include "dashql/proto/tql.pb.h"
#include "dashql/proto/tql_codec.h"
#include "dashql/proto/web_api.pb.h"

#include <cstdio>
#include <iostream>
#include <memory>
#include <optional>
#include <string_view>
#include <unordered_map>

using namespace dashql;

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
WebAPI::Response::Response(WebAPI::Session& session): session(session), status_code(), error(), data() {}

/// Constructor
WebAPI::Response::~Response() {
    clear();
}

/// Constructor
WebAPI::Session::Session(std::shared_ptr<duckdb::DuckDB> database): database(std::move(database)), buffers(), response(*this), nextQueryID() {}

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
    duckdb::Parser parser;
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
    auto message = encodeQueryPlan(arena, *planner.plan);
    auto buffer = serializeMessage(*message);

    // Return buffer
    response.requestSucceeded(buffer);
}

/// Constructor
WebAPI::WebAPI(): database(std::make_shared<duckdb::DuckDB>()), sessions() {
    database->scheduler->SetThreads(4);
}

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
    uint32_t computeZ(uint16_t xIn, uint16_t yIn) {
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

    struct ZEntry {
        uint32_t zPos;
        uint16_t elementID;

        ZEntry(uint32_t zPos, uint16_t elementID): zPos(zPos), elementID(elementID) {}
    };

} // namespace

/// Compute a grid layout
void WebAPI::computeGridLayout(nonstd::span<GridElement> elements, nonstd::span<GridArea> areas, uint16_t columns) {
    // The number of positioned elements
    uint16_t positionedElements = 0;
    // Remember the allocated number of rows
    uint16_t allocatedRows = 0;
    // Maintain a logical clock to determine whether we considered an overlap already
    uint16_t elementEpoch = 0;

    // Remember the last element checks
    std::vector<uint16_t> elementChecks;
    elementChecks.resize(elements.size(), 0);

    // Remember entries in the z-index
    std::vector<ZEntry> zIndex;
    zIndex.reserve(elements.size() * 4);
    auto addZ = [](std::vector<ZEntry>& zIndex, uint32_t zPos, uint16_t elementID) {
        auto iter = std::upper_bound(zIndex.begin(), zIndex.end(), zPos, [](auto z, auto& v) { return v.zPos < z; });
        zIndex.insert(iter, ZEntry{zPos, elementID});
    };

    // Insert all the elements
    uint16_t xBegin = 0;
    uint16_t yBegin = 0;
    for (auto& elem : elements) {
        ++elementEpoch;
        bool elementDone = false;
        auto xUB = xBegin;
        auto yUB = std::numeric_limits<uint16_t>::max();

        // Scan all the existing rows
        for (; yBegin < allocatedRows && !elementDone; yBegin = std::min<uint16_t>(yUB, yBegin + 1), xBegin = 0, xUB = 0) {
            for (; xBegin + elem.width <= columns; xBegin = xUB) {
                uint16_t xEnd = xBegin + elem.width;
                uint16_t yEnd = yBegin + elem.height;

                // Search candidates
                auto anchorNW = computeZ(xBegin, yBegin);
                auto anchorNE = computeZ(xEnd, yBegin);
                auto anchorSE = computeZ(xEnd, yEnd);
                auto anchorSW = computeZ(xBegin, yEnd);
                auto zLB = zIndex.begin() + (zIndex.rend() - std::lower_bound(zIndex.rbegin(), zIndex.rend(), anchorNW, [](auto& e, auto v) { return e.zPos > v; }));
                auto zUB = std::lower_bound(zIndex.begin(), zIndex.end(), anchorSE, [](auto& e, auto v) { return e.zPos < v; });

                // Check iterators
                bool foundConflict = false;
                for (auto iter = zLB; iter < zUB; ++iter) {
                    auto& candidate = areas[iter->elementID];

                    // Already checked?
                    // Positioned elements have multiple entries in the z-index.
                    // We will likely see the same element multiple times in the range.
                    if (elementChecks[iter->elementID] >= elementEpoch) {
                        continue;
                    }
                    elementChecks[iter->elementID] = elementEpoch;

                    // Element overlaps?
                    auto xOverlaps = !(xEnd <= candidate.xBegin || xBegin >= candidate.xEnd);
                    auto yOverlaps = !(yEnd <= candidate.yBegin || yBegin >= candidate.yBegin);
                    if (xOverlaps || yOverlaps) {
                        foundConflict = true;
                        xUB = std::max<uint16_t>(xUB, candidate.xEnd);
                        yUB = std::min<uint16_t>(yUB, candidate.yEnd);
                    }
                }

                // No conflict? Insert the element here
                if (!foundConflict) {
                    auto elementID = positionedElements++;
                    areas[elementID] = GridArea{xBegin, xEnd, yBegin, yEnd};
                    addZ(zIndex, anchorNW, elementID);
                    addZ(zIndex, anchorNE, elementID);
                    addZ(zIndex, anchorSE, elementID);
                    addZ(zIndex, anchorSW, elementID);
                    allocatedRows = std::max<uint16_t>(allocatedRows, yEnd);
                    elementDone = true;
                    break;
                }
            }
        }

        // Insert in new row, if necessary
        if (!elementDone) {
            uint16_t xBegin = 0;
            uint16_t xEnd = elem.width;
            uint16_t yBegin = allocatedRows;
            uint16_t yEnd = yBegin + elem.height;
            auto anchorNW = computeZ(xBegin, yBegin);
            auto anchorNE = computeZ(xEnd, yBegin);
            auto anchorSE = computeZ(xEnd, yEnd);
            auto anchorSW = computeZ(xBegin, yEnd);
            auto elementID = positionedElements++;
            areas[elementID] = GridArea{xBegin, xEnd, yBegin, yEnd};
            addZ(zIndex, anchorNW, elementID);
            addZ(zIndex, anchorNE, elementID);
            addZ(zIndex, anchorSE, elementID);
            addZ(zIndex, anchorSW, elementID);
            allocatedRows += elem.height;
        }
    }
}
