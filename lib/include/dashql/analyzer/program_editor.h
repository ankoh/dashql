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
#include "dashql/analyzer/input_value.h"
#include "dashql/common/enum.h"
#include "dashql/common/union_find.h"
#include "dashql/proto_generated.h"
#include "nonstd/span.h"

namespace dashql {

/// A program editor
class ProgramEditor {
    /// The current program
    ProgramInstance& instance_;

    /// Rewrite an inpout statement
    std::string RewriteInputStatement(size_t stmt_id, nonstd::span<const proto::edit::EditOperation*> edit) const;
    /// Rewrite a viz statement
    std::string RewriteVizStatement(size_t stmt_id, nonstd::span<const proto::edit::EditOperation*> edit) const;

   public:
    /// Constructor
    ProgramEditor(ProgramInstance& program);

    /// Apply the current program edit
    std::string Apply(const proto::edit::ProgramEdit& edit);
};

}  // namespace dashql

#endif  // INCLUDE_DASHQL_PROGRAM_INSTANCE_H_
