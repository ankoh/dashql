// package: tigon.proto.rpath
// file: rpath.proto

import * as jspb from "google-protobuf";

export class ArraySlice extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ArraySlice.AsObject;
  static toObject(includeInstance: boolean, msg: ArraySlice): ArraySlice.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ArraySlice, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ArraySlice;
  static deserializeBinaryFromReader(message: ArraySlice, reader: jspb.BinaryReader): ArraySlice;
}

export namespace ArraySlice {
  export type AsObject = {
  }
}

export class ArrayIndexes extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ArrayIndexes.AsObject;
  static toObject(includeInstance: boolean, msg: ArrayIndexes): ArrayIndexes.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ArrayIndexes, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ArrayIndexes;
  static deserializeBinaryFromReader(message: ArrayIndexes, reader: jspb.BinaryReader): ArrayIndexes;
}

export namespace ArrayIndexes {
  export type AsObject = {
  }
}

export class ChildMember extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ChildMember.AsObject;
  static toObject(includeInstance: boolean, msg: ChildMember): ChildMember.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ChildMember, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ChildMember;
  static deserializeBinaryFromReader(message: ChildMember, reader: jspb.BinaryReader): ChildMember;
}

export namespace ChildMember {
  export type AsObject = {
  }
}

export class DescendantMember extends jspb.Message {
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): DescendantMember.AsObject;
  static toObject(includeInstance: boolean, msg: DescendantMember): DescendantMember.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: DescendantMember, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): DescendantMember;
  static deserializeBinaryFromReader(message: DescendantMember, reader: jspb.BinaryReader): DescendantMember;
}

export namespace DescendantMember {
  export type AsObject = {
  }
}

export class ComponentUnion extends jspb.Message {
  hasArrayslice(): boolean;
  clearArrayslice(): void;
  getArrayslice(): ArraySlice | undefined;
  setArrayslice(value?: ArraySlice): void;

  hasArrayindexes(): boolean;
  clearArrayindexes(): void;
  getArrayindexes(): ArrayIndexes | undefined;
  setArrayindexes(value?: ArrayIndexes): void;

  hasChildmember(): boolean;
  clearChildmember(): void;
  getChildmember(): ChildMember | undefined;
  setChildmember(value?: ChildMember): void;

  hasDescendantmember(): boolean;
  clearDescendantmember(): void;
  getDescendantmember(): DescendantMember | undefined;
  setDescendantmember(value?: DescendantMember): void;

  getComponentCase(): ComponentUnion.ComponentCase;
  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ComponentUnion.AsObject;
  static toObject(includeInstance: boolean, msg: ComponentUnion): ComponentUnion.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ComponentUnion, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ComponentUnion;
  static deserializeBinaryFromReader(message: ComponentUnion, reader: jspb.BinaryReader): ComponentUnion;
}

export namespace ComponentUnion {
  export type AsObject = {
    arrayslice?: ArraySlice.AsObject,
    arrayindexes?: ArrayIndexes.AsObject,
    childmember?: ChildMember.AsObject,
    descendantmember?: DescendantMember.AsObject,
  }

  export enum ComponentCase {
    COMPONENT_NOT_SET = 0,
    ARRAYSLICE = 1,
    ARRAYINDEXES = 2,
    CHILDMEMBER = 3,
    DESCENDANTMEMBER = 4,
  }
}

export class Path extends jspb.Message {
  clearComponentsList(): void;
  getComponentsList(): Array<ComponentUnion>;
  setComponentsList(value: Array<ComponentUnion>): void;
  addComponents(value?: ComponentUnion, index?: number): ComponentUnion;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): Path.AsObject;
  static toObject(includeInstance: boolean, msg: Path): Path.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: Path, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): Path;
  static deserializeBinaryFromReader(message: Path, reader: jspb.BinaryReader): Path;
}

export namespace Path {
  export type AsObject = {
    componentsList: Array<ComponentUnion.AsObject>,
  }
}

