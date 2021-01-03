"use strict";
// Copyright (c) 2020 The DashQL Authors
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
exports.__esModule = true;
exports.WebDB = void 0;
var webdb_wasm_node_wasm_1 = require("./webdb_wasm_node.wasm");
var webdb_wasm_node_js_1 = require("./webdb_wasm_node.js");
var webdb_bindings_1 = require("./webdb_bindings");
var fs_1 = require("fs");
/// WebDB bindings for node.js
var WebDB = /** @class */ (function (_super) {
    __extends(WebDB, _super);
    function WebDB(runtime, path) {
        if (runtime === void 0) { runtime = {}; }
        if (path === void 0) { path = null; }
        var _this = _super.call(this) || this;
        _this.runtime = runtime;
        _this.path = path !== null && path !== void 0 ? path : webdb_wasm_node_wasm_1["default"];
        return _this;
    }
    /// Instantiate the wasm module
    WebDB.prototype.instantiateWasm = function (imports, success) {
        var imports_rt = __assign(__assign({}, imports), { env: __assign(__assign({}, imports.env), this.runtime) });
        var buf = fs_1["default"].readFileSync(this.path);
        WebAssembly.instantiate(buf, imports_rt).then(function (output) {
            success(output.instance);
        });
        return [];
    };
    /// Instantiate the bindings
    WebDB.prototype.instantiate = function (moduleOverrides) {
        return webdb_wasm_node_js_1["default"](__assign(__assign({}, moduleOverrides), { instantiateWasm: this.instantiateWasm.bind(this) }));
    };
    return WebDB;
}(webdb_bindings_1.WebDBBindings));
exports.WebDB = WebDB;
