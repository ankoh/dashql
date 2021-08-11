// Copyright (c) 2020 The DashQL Authors

import { JMESPathModule } from './jmespath_wasm_module';
import * as utils from '../utils';

/** The proxy for either the browser- order node-based DashQLJMESPath API */
export abstract class JMESPathBindings {
    /** The instance */
    private _instance: JMESPathModule | null = null;
    /** The loading promise */
    private _open_promise: Promise<void> | null = null;
    /** The resolver for the open promise (called by onRuntimeInitialized) */
    private _open_promise_resolver: () => void = () => {};

    /** Instantiate the module */
    protected abstract instantiate(moduleOverrides: Partial<JMESPathModule>): Promise<JMESPathModule>;

    /** Decode a string */
    public readString(begin: number, length: number): string {
        return utils.decodeText(this._instance!.HEAPU8.subarray(begin, begin + length));
    }

    /** Init the module */
    public async init(): Promise<void> {
        // Already opened?
        if (this._instance != null) {
            return;
        }
        // Open in progress?
        if (this._open_promise != null) {
            await this._open_promise;
        }

        // Create a promise that we can await
        this._open_promise = new Promise(resolve => {
            this._open_promise_resolver = resolve;
        });

        // Initialize duckdb
        this._instance = await this.instantiate({
            print: console.log.bind(console),
            printErr: console.log.bind(console),
            onRuntimeInitialized: this._open_promise_resolver,
        });

        // Wait for onRuntimeInitialized
        await this._open_promise;
        this._open_promise = null;
    }

    // Call a core function with packed response buffer
    protected callSRet(
        funcName: string,
        argTypes: Array<Emscripten.JSType>,
        args: Array<any>,
    ): [number, number, number] {
        // Save the stack
        const instance = this._instance!;
        const stackPointer = instance.stackSave();

        // Allocate the packed response buffer
        const response = instance.stackAlloc(3 * 8);
        argTypes.unshift('number');
        args.unshift(response);

        // Do the call
        instance.ccall(funcName, null, argTypes, args);

        // Read the response
        const status = instance.HEAPF64[(response >> 3) + 0];
        const data = instance.HEAPF64[(response >> 3) + 1];
        const dataSize = instance.HEAPF64[(response >> 3) + 2];

        // Restore the stack
        instance.stackRestore(stackPointer);
        return [status, data, dataSize];
    }

    /** Parse a string and return a flatbuffer */
    public evaluate(expression: string, input: string): string {
        const instance = this._instance!;
        const stackPointer = instance.stackSave();

        // Call the parse function
        const [s, ofs, size] = this.callSRet('jmespath_evaluate', ['string', 'string'], [expression, input]);
        if (s !== utils.StatusCode.SUCCESS) {
            throw new Error(this.readString(ofs, size));
        }
        const result = this.readString(ofs, size);
        instance.ccall('jmespath_clear_response', null, [], []);

        // Clear the utf8 string buffer
        instance.stackRestore(stackPointer);

        // Wrap the program
        return result;
    }

    /** Parse a string and return a flatbuffer */
    public evaluateUTF8(expression: string, utf8: Uint8Array): Uint8Array {
        const instance = this._instance!;
        const stackPointer = instance.stackSave();

        // Copy the buffer to the heap
        const utf8Buffer = instance.stackAlloc(utf8.length);
        instance.HEAPU8.subarray(utf8Buffer, utf8Buffer + utf8.length).set(utf8);

        // Call the parse function
        const [s, ofs, size] = this.callSRet(
            'jmespath_evaluate_utf8',
            ['string', 'number', 'number'],
            [expression, utf8Buffer, utf8.length],
        );
        if (s !== utils.StatusCode.SUCCESS) {
            throw new Error(this.readString(ofs, size));
        }

        // Copy the utf8 buffer
        const result = instance.HEAPU8.subarray(ofs, ofs + size);
        const copy = new Uint8Array(new ArrayBuffer(result.byteLength));
        copy.set(result);

        // Clear the response
        instance.ccall('jmespath_clear_response', null, [], []);
        // Clear everything that we put on the stack
        instance.stackRestore(stackPointer);
        // Return the result
        return copy;
    }
}
