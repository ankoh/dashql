// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/tablegen.h"
#include "duckdb/main/appender.hpp"
#include <tuple>

namespace duckdb_webapi {

namespace {

/// Translate a type
duckdb::LogicalType translate(const proto::LogicalType& type) {
    switch (type.type_id()) {
        default:
            return duckdb::LogicalType();
    }
}

/// A data distribution
struct DataDistribution {
    /// The appender
    duckdb::Appender& appender;
    /// The spec
    const proto::DataDistribution* dist;
    /// Constructor
    DataDistribution(duckdb::Appender& appender, const proto::DataDistribution* dist)
        : appender(appender), dist(dist) {}
    /// Destructor
    virtual ~DataDistribution() = default;
    /// Append value
    virtual void append() = 0;
};

/// Translate the distribution
std::unique_ptr<DataDistribution> translate(const proto::DataDistribution* dist) {
    return nullptr;
}

/// A value generator
struct ValueGenerator {
    /// The appender
    duckdb::Appender& appender;
    /// The spec
    const proto::ColumnSpec* spec;
    /// The value distribution
    std::unique_ptr<DataDistribution> valueDist;
    /// The null distribution
    std::unique_ptr<DataDistribution> nullDist;

    /// Constructor
    ValueGenerator(duckdb::Appender& appender, const proto::ColumnSpec* spec)
        : appender(appender), spec(spec), valueDist(translate(spec->value_distribution())), nullDist(translate(spec->null_distribution())) {}
    /// Destructor
    virtual ~ValueGenerator() = default;
    /// Append value
    virtual void append() = 0;
};

/// An integer generator
struct IntegerGenerator: public ValueGenerator {
    IntegerGenerator(duckdb::Appender& appender, const proto::ColumnSpec* spec)
        : ValueGenerator(appender, spec) {}
};

}

/// Generate table
void generateTable(duckdb::Connection& conn, proto::TableSpec& spec) {
    /// Get the column name
    std::vector<std::pair<const char*, duckdb::LogicalType>> columns;
    for (unsigned i = 0; i < spec.columns()->size(); ++i) {
        auto col = spec.columns()->Get(i);
        auto name = col->name()->c_str();
        auto valueType = translate(*col->value_type());
        columns.push_back({name, valueType});
    }

    // Build CREATE TABLE statement
    std::stringstream stmt{"CREATE TABLE "};
    stmt << spec.name()->c_str();
    stmt << " (";
    bool first = true;
    for (auto iter = columns.begin(); iter != columns.end(); ++iter, first = false) {
        auto& [name, type] = *iter;
        if (!first)
            stmt << ", ";
        stmt << name << std::endl;
        stmt << type.ToString();
    }
    stmt << ")";
    conn.Query(stmt.str());

    // Create values
    duckdb::Appender appender(conn, spec.name()->c_str());
    std::vector<std::unique_ptr<ValueGenerator>> values;
    for (unsigned i = 0; i < spec.columns()->size(); ++i) {
        auto col = spec.columns()->Get(i);
        auto name = col->name()->c_str();
        auto valueType = col->value_type();
        auto valueDist = translate(col->value_distribution());
        auto nullDist = translate(col->null_distribution());
        switch (valueType->type_id()) {
            case proto::LogicalTypeID::INTEGER:
                break;
            default:
                break;
        }
    }

    // Initialize the appender
    for (unsigned row = 0; row < spec.rows(); ++row) {
        appender.BeginRow();
        for (auto& gen: values)
            gen->append();
        appender.EndRow();
    }
}

}
