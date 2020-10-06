// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/value.h"

namespace duckdb_webapi {

namespace {

/// Get a logical from a physical type
proto::LogicalType getLogicalFromPhysicalType(proto::PhysicalTypeID type) {
    switch (type) {
    case proto::PhysicalTypeID::BOOL:
        return proto::LogicalType{proto::LogicalTypeID::BOOLEAN, 0, 0};
    case proto::PhysicalTypeID::INT8:
        return proto::LogicalType{proto::LogicalTypeID::TINYINT, 0, 0};
    case proto::PhysicalTypeID::INT16:
        return proto::LogicalType{proto::LogicalTypeID::SMALLINT, 0, 0};
    case proto::PhysicalTypeID::INT32:
        return proto::LogicalType{proto::LogicalTypeID::INTEGER, 0, 0};
    case proto::PhysicalTypeID::INT64:
        return proto::LogicalType{proto::LogicalTypeID::BIGINT, 0, 0};
    case proto::PhysicalTypeID::FLOAT:
        return proto::LogicalType{proto::LogicalTypeID::FLOAT, 0, 0};
    case proto::PhysicalTypeID::DOUBLE:
        return proto::LogicalType{proto::LogicalTypeID::DOUBLE, 0, 0};
    case proto::PhysicalTypeID::VARCHAR:
        return proto::LogicalType{proto::LogicalTypeID::VARCHAR, 0, 0};
    case proto::PhysicalTypeID::VARBINARY:
        return proto::LogicalType{proto::LogicalTypeID::VARBINARY, 0, 0};
    default:
        assert(false);
        return proto::LogicalType{proto::LogicalTypeID::INVALID, 0, 0};
    }
}

}

/// Get a sql type
proto::LogicalType Value::getLogicalType() {
    return logicalType.type_id() == proto::LogicalTypeID::INVALID ? getLogicalFromPhysicalType(physicalType)
                                                                    : logicalType;
}

} // namespace duckdb_webapi
