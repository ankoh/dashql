// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/tablegen.h"
#include "duckdb_webapi/common/span.h"
#include "duckdb/main/appender.hpp"

#include <tuple>
#include <random>
#include <variant>

namespace duckdb_webapi {

namespace {

constexpr size_t VECTOR_SIZE = 128;
struct DataVector {
    /// The values
    std::array<int64_t, VECTOR_SIZE> values;
    /// The nulls
    std::array<bool, VECTOR_SIZE> nulls;
    /// Get the vector size
    constexpr size_t size() const { return VECTOR_SIZE; }
};

struct GeneratorExpression {
    /// Destructor
    virtual ~GeneratorExpression() = default;
    /// Generate a value
    virtual DataVector& generate() = 0;
};

struct SourceGeneratorExpression: public GeneratorExpression {
    /// The data vector
    DataVector data;
};

struct ConstantInt : public SourceGeneratorExpression {
    /// The constant value
    int64_t value;
    /// Constructor
    ConstantInt(int64_t value)
        : value(value) {}
    /// Generate values
    DataVector& generate() override {
        for (unsigned i = 0; i < data.size(); ++i) {
            data.values[i] = value;
            data.nulls[i] = false;
        }
        return data;
    }
};

struct ColumnRef : public SourceGeneratorExpression {
    /// The target data vector
    DataVector& column;
    /// Constructor
    ColumnRef(DataVector& col)
        : column(col) {}
    /// Generate values
    DataVector& generate() override {
        for (unsigned i = 0; i < data.size(); ++i) {
            data.values[i] = column.values[i];
            data.nulls[i] = column.nulls[i];
        }
        return data;
    }
};

template <typename D>
struct GenericDistribution : public SourceGeneratorExpression {
    /// The generator
    std::mt19937& generator;
    /// The distribution
    D distribution;
    /// The scaling
    int64_t scaling;
    /// Constructor
    GenericDistribution(std::mt19937& gen, D&& dist)
        : generator(gen), distribution(move(dist)), scaling(1) {}
    /// Generate values
    DataVector& generate() override {
        for (unsigned i = 0; i < data.size(); ++i) {
            data.values[i] = distribution(generator) * scaling;
            data.nulls[i] = false;
        }
        return data;
    }
};

template <template <typename> class D, typename T>
struct HigherOrderDistribution : public SourceGeneratorExpression {
    /// The generator
    std::mt19937& generator;
    /// The distribution
    D<T> distribution;
    /// The scaling
    int64_t scaling;
    /// Constructor
    HigherOrderDistribution(std::mt19937& gen, D<T>&& dist)
        : generator(gen), distribution(move(dist)) {}
    /// Generate values
    DataVector& generate() override {
        for (unsigned i = 0; i < data.size(); ++i) {
            data.values[i] = distribution(generator) * scaling;
            data.nulls[i] = false;
        }
        return data;
    }
};

using UniformIntDistribution = HigherOrderDistribution<std::uniform_int_distribution, int64_t>;
using BernoulliDistribution = GenericDistribution<std::bernoulli_distribution>;
using BinomialDistribution = HigherOrderDistribution<std::binomial_distribution, int64_t>;
using GeometricDistribution = HigherOrderDistribution<std::geometric_distribution, int64_t>;
using NegativeBinomialDistribution = HigherOrderDistribution<std::negative_binomial_distribution, int64_t>;
using PoissonDistribution = HigherOrderDistribution<std::poisson_distribution, int64_t>;
using ExponentialDistribution = HigherOrderDistribution<std::exponential_distribution, double>;
using GammaDistribution = HigherOrderDistribution<std::gamma_distribution, double>;
using ExtremeValueDistribution = HigherOrderDistribution<std::extreme_value_distribution, double>;
using NormalDistribution = HigherOrderDistribution<std::normal_distribution, double>;
using LogNormalDistribution = HigherOrderDistribution<std::lognormal_distribution, double>;
using ChiSquaredDistribution = HigherOrderDistribution<std::chi_squared_distribution, double>;
using CauchyDistribution = HigherOrderDistribution<std::cauchy_distribution, double>;
using FisherFDistribution = HigherOrderDistribution<std::fisher_f_distribution, double>;
using StudentTDistribution = HigherOrderDistribution<std::student_t_distribution, double>;
using DiscreteDistribution = HigherOrderDistribution<std::discrete_distribution, double>;
using PiecewiseConstantDistribution = HigherOrderDistribution<std::piecewise_constant_distribution, double>;
using PiecewiseLinearDistribution = HigherOrderDistribution<std::piecewise_linear_distribution, double>;

struct BinaryGeneratorExpression: public GeneratorExpression {
    /// The input expressions
    std::unique_ptr<GeneratorExpression> left, right;
    /// Constructor
    BinaryGeneratorExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : left(move(left)), right(move(right)) {}
    /// Merge null values
    void mergeNulls(DataVector& l, DataVector& r) {
        for (unsigned i = 0; i < l.size(); ++i)
            l.nulls[i] |= r.nulls[i];
    }
};

struct AddExpression: public BinaryGeneratorExpression {
    /// Constructor
    AddExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] += r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct SubExpression: public BinaryGeneratorExpression {
    /// Constructor
    SubExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] -= r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct MulExpression: public BinaryGeneratorExpression {
    /// Constructor
    MulExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] *= r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct DivExpression: public BinaryGeneratorExpression {
    /// Constructor
    DivExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] = (r.values[i] == 0) ? 0 : (l.values[i] / r.values[i]);
        mergeNulls(l, r);
        return l;
    }
};

struct CompareLTExpression: public BinaryGeneratorExpression {
    /// Constructor
    CompareLTExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] = l.values[i] < r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct CompareLEQExpression: public BinaryGeneratorExpression {
    /// Constructor
    CompareLEQExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] = l.values[i] <= r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct CompareGTExpression: public BinaryGeneratorExpression {
    /// Constructor
    CompareGTExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] = l.values[i] > r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct CompareGEQExpression: public BinaryGeneratorExpression {
    /// Constructor
    CompareGEQExpression(std::unique_ptr<GeneratorExpression> left, std::unique_ptr<GeneratorExpression> right)
        : BinaryGeneratorExpression(move(left), move(right)) {}
    /// Generate values
    DataVector& generate() override {
        auto& l = left->generate();
        auto& r = left->generate();
        for (unsigned i = 0; i < l.size(); ++i)
            l.values[i] = l.values[i] >= r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

} // namespace

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
