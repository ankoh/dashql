// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/tablegen.h"
#include "duckdb/main/appender.hpp"
#include <tuple>
#include <random>
#include <variant>

namespace duckdb_webapi {

// namespace {
// 
// /// Translate a type
// duckdb::LogicalType translate(const proto::LogicalType& type) {
//     switch (type.type_id()) {
//         default:
//             return duckdb::LogicalType();
//     }
// }
// 
// /// A data distribution
// struct DataDistribution {
//     /// The random generator
//     std::mt19937& random;
//     /// The appender
//     duckdb::Appender& appender;
//     /// The column type
//     const proto::LogicalType* valueType;
//     /// The spec
//     const proto::DataDistribution* valueDist;
//     /// Constructor
//     DataDistribution(std::mt19937& random, duckdb::Appender& appender, const proto::LogicalType* valueType, const proto::DataDistribution* valueDist)
//         : random(random), appender(appender), valueType(valueType), valueDist(valueDist) {}
//     /// Destructor
//     virtual ~DataDistribution() = default;
//     /// Get an integer
//     virtual void append() = 0;
// };
// 
// template <typename T>
// struct GenericNormalDistribution: public DataDistribution {
//     std::normal_distribution<T> dist;
//     void append() override {
//         appender.Append<T>(dist(random));
//     }
// };
// 
// /// Translate the distribution
// std::unique_ptr<DataDistribution> translate(const proto::DataDistribution* dist) {
//     switch (dist->distribution_type()) {
//         case proto::DataDistributionType::NORMAL:
//             break;
//         default:
//             break;
//     }
//     return nullptr;
// }
// 
// /// A value generator
// struct ValueGenerator {
//     /// The random generator
//     std::mt19937& random;
//     /// The appender
//     duckdb::Appender& appender;
//     /// The column spec
//     const proto::ColumnSpec* spec;
//     /// The value distribution
//     std::variant<
//         std::bernoulli_distribution,
//         std::binomial_distribution<int64_t>,
//         std::geometric_distribution<int64_t>,
//         std::negative_binomial_distribution<int64_t>,
//         std::exponential_distribution<double>,
//         std::weibull_distribution<double>,
//         std::extreme_value_distribution<double>,
//         std::normal_distribution<double>,
//         std::lognormal_distribution<double>,
//         std::chi_squared_distribution<double>,
//         std::cauchy_distribution<double>,
//         std::fisher_f_distribution<double>,
//         std::student_t_distribution<double>,
//         std::discrete_distribution<int64_t>,
//         std::piecewise_constant_distribution<double>,
//         std::piecewise_linear_distribution<double>
//     > valueDist;
//     /// The null distribution
//     std::optional<std::bernoulli_distribution> nullDist;
// 
//     /// Constructor
//     ValueGenerator(std::mt19937& random, duckdb::Appender& appender, const proto::ColumnSpec* spec);
//     /// Destructor
//     virtual ~ValueGenerator() = default;
//     /// Append value
//     void append();
// };
// 
// /// Constructor
// ValueGenerator::ValueGenerator(std::mt19937& random, duckdb::Appender& appender, const proto::ColumnSpec* spec)
//     : random(random), appender(appender), spec(spec), nullDist(std::nullopt) {
// 
//     // Create the value distribution state
//     // valueDist = [&]() {
//     //     auto dist = spec->value_distribution();
//     //     switch (dist->distribution_type()) {
//     //         case proto::DataDistributionType::NORMAL:
//     //             return ;
//     //         default:
//     //             break;
//     //     }
//     // }();
// 
//     // Create the null distribution
//     
// }
// 
// /// Append value
// void ValueGenerator::append() {
//     
// }
// 
// }
// 
// /// Generate table
// void generateTable(duckdb::Connection& conn, proto::TableSpec& spec) {
//     /// Get the column name
//     std::vector<std::pair<const char*, duckdb::LogicalType>> columns;
//     for (unsigned i = 0; i < spec.columns()->size(); ++i) {
//         auto col = spec.columns()->Get(i);
//         auto name = col->name()->c_str();
//         auto valueType = translate(*col->value_type());
//         columns.push_back({name, valueType});
//     }
// 
//     // Build CREATE TABLE statement
//     std::stringstream stmt{"CREATE TABLE "};
//     stmt << spec.name()->c_str();
//     stmt << " (";
//     bool first = true;
//     for (auto iter = columns.begin(); iter != columns.end(); ++iter, first = false) {
//         auto& [name, type] = *iter;
//         if (!first)
//             stmt << ", ";
//         stmt << name << std::endl;
//         stmt << type.ToString();
//     }
//     stmt << ")";
//     conn.Query(stmt.str());
// 
//     // Create value gernators
//     std::mt19937 rnd;
//     duckdb::Appender appender(conn, spec.name()->c_str());
//     std::vector<ValueGenerator> values;
//     for (unsigned i = 0; i < spec.columns()->size(); ++i)
//         values.emplace_back(rnd, appender, spec.columns()->Get(i));
// 
//     // Initialize the appender
//     for (unsigned row = 0; row < spec.rows(); ++row) {
//         appender.BeginRow();
//         for (auto& gen: values)
//             gen.append();
//         appender.EndRow();
//     }
// }

void generateTable(duckdb::Connection& conn, proto::TableSpecification& spec) {
    (void)conn;
    (void)spec;
}

}
