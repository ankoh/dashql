// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/tablegen.h"
#include "duckdb/main/appender.hpp"
#include "duckdb_webapi/common/span.h"

#include <random>
#include <tuple>
#include <unordered_map>
#include <variant>

using namespace std;

namespace duckdb_webapi {

namespace {

constexpr size_t VECTOR_SIZE = 64;
struct DataVector {
    /// The values
    array<int64_t, VECTOR_SIZE> values;
    /// The nulls
    array<bool, VECTOR_SIZE> nulls;
    /// Get the vector size
    constexpr size_t size() const { return VECTOR_SIZE; }
};

struct GeneratorExpression {
    /// The output data
    DataVector out;
    /// Destructor
    virtual ~GeneratorExpression() = default;
    /// Get the output
    auto &getOutput() const { return out; }
    /// Generate a value
    virtual const DataVector &generate() = 0;
};

struct ConstantInt : public GeneratorExpression {
    /// The constant value
    int64_t value;
    /// Constructor
    ConstantInt(int64_t value) : value(value) {}
    /// Generate values
    const DataVector &generate() override {
        for (unsigned i = 0; i < out.size(); ++i) {
            out.values[i] = value;
            out.nulls[i] = false;
        }
        return out;
    }
};

struct ColumnRef : public GeneratorExpression {
    /// The target data vector
    DataVector &column;
    /// Constructor
    ColumnRef(DataVector &col) : column(col) {}
    /// Generate values
    const DataVector &generate() override {
        for (unsigned i = 0; i < out.size(); ++i) {
            out.values[i] = column.values[i];
            out.nulls[i] = column.nulls[i];
        }
        return out;
    }
};

template <typename D> struct GenericDistribution : public GeneratorExpression {
    /// The generator
    mt19937 &generator;
    /// The distribution
    D distribution;
    /// The scaling
    int64_t scaling;
    /// Constructor
    GenericDistribution(mt19937 &gen, D &&dist) : generator(gen), distribution(move(dist)), scaling(1) {}
    /// Generate values
    const DataVector &generate() override {
        for (unsigned i = 0; i < out.size(); ++i) {
            out.values[i] = distribution(generator) * scaling;
            out.nulls[i] = false;
        }
        return out;
    }
};

template <template <typename> class D, typename T> struct HigherOrderDistribution : public GeneratorExpression {
    /// The generator
    mt19937 &generator;
    /// The distribution
    D<T> distribution;
    /// The scaling
    int64_t scaling;
    /// Constructor
    HigherOrderDistribution(mt19937 &gen, D<T> &&dist) : generator(gen), distribution(move(dist)) {}
    /// Generate values
    const DataVector &generate() override {
        for (unsigned i = 0; i < out.size(); ++i) {
            out.values[i] = distribution(generator) * scaling;
            out.nulls[i] = false;
        }
        return out;
    }
};

using UniformIntDistribution = HigherOrderDistribution<uniform_int_distribution, int64_t>;
using BernoulliDistribution = GenericDistribution<bernoulli_distribution>;
using BinomialDistribution = HigherOrderDistribution<binomial_distribution, int64_t>;
using GeometricDistribution = HigherOrderDistribution<geometric_distribution, int64_t>;
using NegativeBinomialDistribution = HigherOrderDistribution<negative_binomial_distribution, int64_t>;
using PoissonDistribution = HigherOrderDistribution<poisson_distribution, int64_t>;
using ExponentialDistribution = HigherOrderDistribution<exponential_distribution, double>;
using GammaDistribution = HigherOrderDistribution<gamma_distribution, double>;
using WeibullDistribution = HigherOrderDistribution<weibull_distribution, double>;
using ExtremeValueDistribution = HigherOrderDistribution<extreme_value_distribution, double>;
using NormalDistribution = HigherOrderDistribution<normal_distribution, double>;
using LogNormalDistribution = HigherOrderDistribution<lognormal_distribution, double>;
using ChiSquaredDistribution = HigherOrderDistribution<chi_squared_distribution, double>;
using CauchyDistribution = HigherOrderDistribution<cauchy_distribution, double>;
using FisherFDistribution = HigherOrderDistribution<fisher_f_distribution, double>;
using StudentTDistribution = HigherOrderDistribution<student_t_distribution, double>;
using DiscreteDistribution = HigherOrderDistribution<discrete_distribution, double>;

struct BinaryGeneratorExpression : public GeneratorExpression {
    /// The input expressions
    unique_ptr<GeneratorExpression> left, right;
    /// Constructor
    BinaryGeneratorExpression() : left(nullptr), right(nullptr) {}
    /// Merge null values
    void mergeNulls(const DataVector &l, const DataVector &r) {
        for (unsigned i = 0; i < out.size(); ++i)
            out.nulls[i] = l.nulls[i] | r.nulls[i];
    }
};

struct AddExpression : public BinaryGeneratorExpression {
    /// Constructor
    AddExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = right->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = l.values[i] + r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct SubExpression : public BinaryGeneratorExpression {
    /// Constructor
    SubExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = right->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = l.values[i] - r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct MulExpression : public BinaryGeneratorExpression {
    /// Constructor
    MulExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = right->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = l.values[i] * r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct DivExpression : public BinaryGeneratorExpression {
    /// Constructor
    DivExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = right->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = (r.values[i] == 0) ? 0 : (l.values[i] / r.values[i]);
        mergeNulls(l, r);
        return l;
    }
};

struct CompareLTExpression : public BinaryGeneratorExpression {
    /// Constructor
    CompareLTExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = left->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = l.values[i] < r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct CompareLEQExpression : public BinaryGeneratorExpression {
    /// Constructor
    CompareLEQExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = left->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = l.values[i] <= r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct CompareGTExpression : public BinaryGeneratorExpression {
    /// Constructor
    CompareGTExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = left->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = l.values[i] > r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct CompareGEQExpression : public BinaryGeneratorExpression {
    /// Constructor
    CompareGEQExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = left->generate();
        for (unsigned i = 0; i < out.size(); ++i)
            out.values[i] = l.values[i] >= r.values[i];
        mergeNulls(l, r);
        return l;
    }
};

struct NullIfExpression : public BinaryGeneratorExpression {
    /// Constructor
    NullIfExpression() : BinaryGeneratorExpression() {}
    /// Generate values
    const DataVector &generate() override {
        auto &l = left->generate();
        auto &r = left->generate();
        for (unsigned i = 0; i < out.size(); ++i) {
            out.values[i] = l.values[i];
            out.nulls[i] = l.nulls[i] | (!r.nulls[i] && r.values[i] != 0);
        }
        mergeNulls(l, r);
        return l;
    }
};

/// The output transformation
struct OutputTransform {
    /// The appender
    duckdb::Appender appender;
    /// A input data vector
    DataVector &in;

    /// Constructor
    OutputTransform(duckdb::Appender &appender, DataVector &in);
    /// Append values
    virtual void append(uint8_t n = VECTOR_SIZE);
};

template <typename KeyType, typename ValueType>
ValueType getArg(const unordered_map<KeyType, ValueType> &target, const KeyType &key, ValueType defaultValue) {
    if (auto iter = target.find(key); iter != target.end())
        return iter->second;
    return defaultValue;
}

} // namespace

/// Generate table
void generateTable(duckdb::Connection &conn, proto::TableSpecification &spec) {
    mt19937 rand;

    // Maintain a data vector per column
    vector<DataVector *> columnData;
    columnData.resize(spec.columns()->size(), nullptr);

    // Construct the generator expressions.
    // Each generator expression is responsible for a single data vector.
    vector<unique_ptr<GeneratorExpression>> columnGenerators;
    columnGenerators.resize(spec.columns()->size());
    for (unsigned i = 0; i < spec.columns()->size(); ++i) {
        auto *col = spec.columns()->Get(i);
        auto *exprs = col->generator();

        // Build expression tree
        vector<unique_ptr<GeneratorExpression>> nodes;
        nodes.resize(exprs->size());
        for (unsigned j = 0; j < exprs->size(); ++j) {
            auto *expr = exprs->Get(j);
            auto *args = expr->arguments();

            // Simplify argument lookup
            using X = proto::GeneratorArgumentType;
            unordered_map<X, const proto::GeneratorArgument *> argMap;
            for (unsigned k = 0; k < args->size(); ++k) {
                auto *arg = args->Get(k);
                argMap.insert({arg->argument_type(), arg});
            }
            auto argi = [&](X key, int64_t defaultValue = 0) {
                if (auto iter = argMap.find(key); iter != argMap.end())
                    return iter->second->value_int();
                return defaultValue;
            };
            auto argfp = [&](X key, double defaultValue = 0.0) {
                if (auto iter = argMap.find(key); iter != argMap.end())
                    return iter->second->value_float();
                return defaultValue;
            };

            // Allocate expression
            // clang-format off
            nodes[j] = [&]() -> unique_ptr<GeneratorExpression> {
                switch (expr->expression_type()) {
                case proto::GeneratorExpressionType::CONSTANT:
                    return make_unique<ConstantInt>(argi(X::CONSTANT_VALUE, 0));
                case proto::GeneratorExpressionType::COLUMN_REF:
                    /// XXX bounds check
                    return make_unique<ColumnRef>(*columnData[argi(X::COLUMN_REF_INDEX)]);

                case proto::GeneratorExpressionType::RANDOM_BERNOULLI:
                    return make_unique<BernoulliDistribution>(rand, bernoulli_distribution{argfp(X::RANDOM_BERNOULLI_PROBABILITY)});
                case proto::GeneratorExpressionType::RANDOM_UNIFORM:
                    return make_unique<UniformIntDistribution>(rand, uniform_int_distribution<int64_t>{argi(X::RANDOM_UNIFORM_LB), argi(X::RANDOM_UNIFORM_UB)});
                case proto::GeneratorExpressionType::RANDOM_BINOMIAL:
                    return make_unique<BinomialDistribution>(rand, binomial_distribution<int64_t>{argi(X::RANDOM_BINOMIAL_UB), argfp(X::RANDOM_BINOMIAL_PROBABILITY)});
                case proto::GeneratorExpressionType::RANDOM_GEOMETRIC:
                    return make_unique<GeometricDistribution>(rand, geometric_distribution<int64_t>{argfp(X::RANDOM_GEOMETRIC_PROBABILITY)});
                case proto::GeneratorExpressionType::RANDOM_NEGATIVE_BINOMIAL:
                    return make_unique<NegativeBinomialDistribution>(rand, negative_binomial_distribution<int64_t>{argi(X::RANDOM_NEGATIVE_BINOMIAL_K), argfp(X::RANDOM_NEGATIVE_BINOMIAL_P)});
                case proto::GeneratorExpressionType::RANDOM_POISSON:
                    return make_unique<PoissonDistribution>(rand, poisson_distribution<int64_t>{argfp(X::RANDOM_POISSON_MEAN)});
                case proto::GeneratorExpressionType::RANDOM_EXPONENTIAL:
                    return make_unique<ExponentialDistribution>(rand, exponential_distribution<double>{argfp(X::RANDOM_EXPONENTIAL_LAMBDA)});
                case proto::GeneratorExpressionType::RANDOM_GAMMA:
                    return make_unique<GammaDistribution>(rand, gamma_distribution<double>{argfp(X::RANDOM_GAMMA_ALPHA), argfp(X::RANDOM_GAMMA_BETA)});
                case proto::GeneratorExpressionType::RANDOM_WEIBULL:
                    return make_unique<WeibullDistribution>(rand, weibull_distribution<double>{argfp(X::RANDOM_WEIBULL_A), argfp(X::RANDOM_WEIBULL_B)});
                case proto::GeneratorExpressionType::RANDOM_EXTREME_VALUE:
                    return make_unique<ExtremeValueDistribution>(rand, extreme_value_distribution<double>{argfp(X::RANDOM_EXTREME_VALUE_A), argfp(X::RANDOM_EXTREME_VALUE_B)});
                case proto::GeneratorExpressionType::RANDOM_NORMAL:
                    return make_unique<NormalDistribution>(rand, normal_distribution<double>{argfp(X::RANDOM_NORMAL_MEAN), argfp(X::RANDOM_NORMAL_STDDEV)});
                case proto::GeneratorExpressionType::RANDOM_LOG_NORMAL:
                    return make_unique<LogNormalDistribution>(rand, lognormal_distribution<double>{argfp(X::RANDOM_LOGNORMAL_M), argfp(X::RANDOM_LOGNORMAL_S)});
                case proto::GeneratorExpressionType::RANDOM_CHI_SQUARED:
                    return make_unique<ChiSquaredDistribution>(rand, chi_squared_distribution<double>{argfp(X::RANDOM_CHISQUARED_N)});
                case proto::GeneratorExpressionType::RANDOM_CAUCHY:
                    return make_unique<CauchyDistribution>(rand, cauchy_distribution<double>{argfp(X::RANDOM_CAUCHY_A), argfp(X::RANDOM_CAUCHY_B)});
                case proto::GeneratorExpressionType::RANDOM_FISHER_F:
                    return make_unique<FisherFDistribution>(rand, fisher_f_distribution<double>{argfp(X::RANDOM_FISHERF_M), argfp(X::RANDOM_FISHERF_N)});
                case proto::GeneratorExpressionType::RANDOM_STUDENT_T:
                    return make_unique<StudentTDistribution>(rand, student_t_distribution<double>{argfp(X::RANDOM_STUDENTT_N)});

                case proto::GeneratorExpressionType::NULL_IF:
                    return make_unique<NullIfExpression>();
                case proto::GeneratorExpressionType::COMPARE_LT:
                    return make_unique<CompareLTExpression>();
                case proto::GeneratorExpressionType::COMPARE_LEQ:
                    return make_unique<CompareLEQExpression>();
                case proto::GeneratorExpressionType::COMPARE_GT:
                    return make_unique<CompareGTExpression>();
                case proto::GeneratorExpressionType::COMPARE_GEQ:
                    return make_unique<CompareGEQExpression>();
                case proto::GeneratorExpressionType::ADD:
                    return make_unique<AddExpression>();
                case proto::GeneratorExpressionType::SUB:
                    return make_unique<SubExpression>();
                case proto::GeneratorExpressionType::MULTIPLY:
                    return make_unique<MulExpression>();
                case proto::GeneratorExpressionType::DIV:
                    return make_unique<DivExpression>();
                }
            }();
            // clang-format on
        }
    }

    //     /// Get the column name
    //     vector<pair<const char*, duckdb::LogicalType>> columns;
    //     for (unsigned i = 0; i < spec.columns()->size(); ++i) {
    //         auto col = spec.columns()->Get(i);
    //         auto name = col->name()->c_str();
    //         auto valueType = translate(*col->value_type());
    //         columns.push_back({name, valueType});
    //     }
    //
    //     // Build CREATE TABLE statement
    //     stringstream stmt{"CREATE TABLE "};
    //     stmt << spec.name()->c_str();
    //     stmt << " (";
    //     bool first = true;
    //     for (auto iter = columns.begin(); iter != columns.end(); ++iter, first = false) {
    //         auto& [name, type] = *iter;
    //         if (!first)
    //             stmt << ", ";
    //         stmt << name << endl;
    //         stmt << type.ToString();
    //     }
    //     stmt << ")";
    //     conn.Query(stmt.str());
    //
    //     // Create value gernators
    //     mt19937 rnd;
    //     duckdb::Appender appender(conn, spec.name()->c_str());
    //     vector<ValueGenerator> values;
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
}

} // namespace duckdb_webapi
