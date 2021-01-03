"use strict";
// Copyright (c) 2020 The DashQL Authors
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
exports.WebDBBindings = exports.WebDBConnection = void 0;
var proto_1 = require("@dashql/proto");
var flatbuffers_1 = require("flatbuffers");
/// Decode a string
function decodeString(buffer) {
    var result = "";
    for (var i = 0; i < buffer.length; i++) {
        result += String.fromCharCode(buffer[i]);
    }
    return result;
}
/// Copy a flatbuffer
function copyFlatbuffer(buffer) {
    var copy = new Uint8Array(new ArrayBuffer(buffer.byteLength));
    copy.set(buffer);
    return new flatbuffers_1.flatbuffers.ByteBuffer(copy);
}
/// A connection to WebDB
var WebDBConnection = /** @class */ (function () {
    /// Constructor
    function WebDBConnection(bindings, conn) {
        this._bindings = bindings;
        this._conn = conn;
    }
    /// Disconnect from database
    WebDBConnection.prototype.disconnect = function () {
        var instance = this._bindings.instance;
        instance.ccall('dashql_webdb_disconnect', null, ['number'], [this._conn]);
    };
    /// Send a query and return the full result
    WebDBConnection.prototype.runQuery = function (text) {
        var instance = this._bindings.instance;
        var _a = this._bindings.callSRet('dashql_webdb_run_query', ['number', 'string'], [this._conn, text]), s = _a[0], d = _a[1], n = _a[2];
        var mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto_1.webdb.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        var res = proto_1.webdb.QueryResult.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    };
    /// Send a query and return a result stream
    WebDBConnection.prototype.sendQuery = function (text) {
        var instance = this._bindings.instance;
        var _a = this._bindings.callSRet('dashql_webdb_send_query', ['number', 'string'], [this._conn, text]), s = _a[0], d = _a[1], n = _a[2];
        var mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto_1.webdb.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        var res = proto_1.webdb.QueryResult.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    };
    /// Fetch query results
    WebDBConnection.prototype.fetchQueryResults = function () {
        var instance = this._bindings.instance;
        var _a = this._bindings.callSRet('dashql_webdb_fetch_query_results', ['number'], [this._conn]), s = _a[0], d = _a[1], n = _a[2];
        var mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto_1.webdb.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        var res = proto_1.webdb.QueryResultChunk.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return res;
    };
    /// Analyze a query
    WebDBConnection.prototype.analyzeQuery = function (_text) {
        var instance = this._bindings.instance;
        var _a = this._bindings.callSRet('dashql_webdb_analyze_query', ['number'], [this._conn]), s = _a[0], d = _a[1], n = _a[2];
        var mem = instance.HEAPU8.subarray(d, d + n);
        if (s !== proto_1.webdb.StatusCode.SUCCESS) {
            throw new Error(decodeString(mem));
        }
        var plan = proto_1.webdb.QueryPlan.getRoot(copyFlatbuffer(mem));
        instance.ccall('dashql_clear_response', null, [], []);
        return plan;
    };
    return WebDBConnection;
}());
exports.WebDBConnection = WebDBConnection;
/// The proxy for either the browser- order node-based WebDB API
var WebDBBindings = /** @class */ (function () {
    function WebDBBindings() {
        /// The instance
        this._instance = null;
        /// The loading promise
        this._openPromise = null;
        /// The resolver for the open promise (called by onRuntimeInitialized)
        this._openPromiseResolver = function () { };
    }
    Object.defineProperty(WebDBBindings.prototype, "instance", {
        /// Get the instance
        get: function () { return this._instance; },
        enumerable: false,
        configurable: true
    });
    /// Open the database
    WebDBBindings.prototype.open = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            var _this = this;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        // Already opened?
                        if (this._instance != null) {
                            return [2 /*return*/];
                        }
                        if (!(this._openPromise != null)) return [3 /*break*/, 2];
                        return [4 /*yield*/, this._openPromise];
                    case 1:
                        _b.sent();
                        _b.label = 2;
                    case 2:
                        // Create a promise that we can await
                        this._openPromise = new Promise(function (resolve) {
                            _this._openPromiseResolver = resolve;
                        });
                        // Initialize webdb
                        _a = this;
                        return [4 /*yield*/, this.instantiate({
                                print: console.log.bind(console),
                                printErr: console.log.bind(console),
                                onRuntimeInitialized: this._openPromiseResolver
                            })];
                    case 3:
                        // Initialize webdb
                        _a._instance = _b.sent();
                        // Wait for onRuntimeInitialized
                        return [4 /*yield*/, this._openPromise];
                    case 4:
                        // Wait for onRuntimeInitialized
                        _b.sent();
                        this._openPromise = null;
                        return [2 /*return*/];
                }
            });
        });
    };
    // Call a core function with packed response buffer
    WebDBBindings.prototype.callSRet = function (funcName, argTypes, args) {
        // Save the stack
        var instance = this._instance;
        var stackPointer = instance.stackSave();
        // Allocate the packed response buffer
        var response = instance.stackAlloc(3 * 8);
        argTypes.unshift('number');
        args.unshift(response);
        // Do the call
        instance.ccall(funcName, null, argTypes, args);
        // Read the response
        // XXX: wasm64 will break here.
        var status = instance.HEAPU32[(response >> 2) + 0];
        var data = instance.HEAPU32[(response >> 2) + 2];
        var dataSize = instance.HEAPU32[(response >> 2) + 4];
        // Restore the stack
        instance.stackRestore(stackPointer);
        return [status, data, dataSize];
    };
    /// Connect to database
    WebDBBindings.prototype.connect = function () {
        var instance = this._instance;
        var conn = instance.ccall('dashql_webdb_connect', 'number', [], []);
        return new WebDBConnection(this, conn);
    };
    return WebDBBindings;
}());
exports.WebDBBindings = WebDBBindings;
;
