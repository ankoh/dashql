//---------------------------------------------------------------------------
// Tigon
// (c) 2019 Andre Kohn
//---------------------------------------------------------------------------

#ifndef INCLUDE_TIGON_EXTRACT_EXTRACT_H_
#define INCLUDE_TIGON_EXTRACT_EXTRACT_H_

#include "duckdb.hpp"
#include "tigon/common/span.h"
#include "tigon/proto/tql_generated.h"

namespace tigon {

class Extract {
  protected:
    /// The connection
    duckdb::Connection& connection;
    /// The tql statement
    proto::TQLExtractStatement &statement;

  public:
    /// Constructor
    Extract(duckdb::Connection& conn, proto::TQLExtractStatement &stmt);
    /// Destructor
    virtual ~Extract() = default;

    /// Prepare the database
    virtual void prepare() = 0;
    /// Extract a buffer into the database
    virtual void read(nonstd::span<std::byte> buffer) = 0;
};

} // namespace tigon

#endif // INCLUDE_TIGON_EXTRACT_EXTRACT_H_
