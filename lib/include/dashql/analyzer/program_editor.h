// Copyright (c) 2020 The DashQL Authors

#ifndef INCLUDE_DASHQL_ANALYZER_PROGRAM_EDITOR_H_
#define INCLUDE_DASHQL_ANALYZER_PROGRAM_EDITOR_H_

#include <iostream>
#include <optional>
#include <sstream>
#include <tuple>
#include <unordered_map>
#include <vector>

#include "dashql/analyzer/analyzer.h"
#include "dashql/analyzer/parameter_value.h"
#include "dashql/analyzer/value.h"
#include "dashql/common/enum.h"
#include "dashql/common/expected.h"
#include "dashql/common/span.h"
#include "dashql/common/union_find.h"
#include "dashql/proto_generated.h"

namespace dashql {

namespace sx = proto::syntax;

/// A program editor
class ProgramEditor {
    /// The analyzer
    Analyzer& analyzer_;
    /// The current program
    ProgramInstance& instance_;

    /// Rewrite a viz statement
    std::string RewriteVizStatement(size_t stmt_id, const proto::edit::ProgramEdit& edit) const;

   public:
    /// Constructor
    ProgramEditor(Analyzer& analyzer, ProgramInstance& program);

    /// Apply the current program edit
    std::string Apply(const proto::edit::ProgramEdit& edit);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
