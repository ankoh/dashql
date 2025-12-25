import * as React from 'react';
import type * as CSS from 'csstype';
import { Provider } from './store.js';
import { Container } from './container.js';

import { BraceLeft } from './symbol/brace_left.js';
import { BraceRight } from './symbol/brace_right.js';
import { BracketsLeft } from './symbol/brackets_left.js';
import { BracketsRight } from './symbol/brackets_right.js';
import { Arrow } from './symbol/arrow.js';
import { Colon } from './symbol/colon.js';
import { Quote } from './symbol/quote.js';
import { ValueQuote } from './symbol/value_quote.js';

import { Bigint } from './types/bigint.js';
import { Date } from './types/date.js';
import { False } from './types/false.js';
import { Float } from './types/float.js';
import { Int } from './types/int.js';
import { Map } from './types/map.js';
import { Nan } from './types/nan.js';
import { Null } from './types/null.js';
import { Set } from './types/set.js';
import { StringText } from './types/string.js';
import { True } from './types/true.js';
import { Undefined } from './types/undefined.js';
import { Url } from './types/url.js';

import { Copied } from './section/copied.js';
import { CountInfo } from './section/count_info.js';
import { CountInfoExtra } from './section/count_info_extra.js';
import { Ellipsis } from './section/ellipsis.js';
import { KeyName } from './section/key_name.js';
import { Row } from './section/row.js';

export * from './store.js';
export * from './store/expands.js';
export * from './store/show_tools.js';
export * from './store/symbols.js';
export * from './store/types.js';
export * from './symbol/index.js';

export type ShouldExpandNodeInitially<T extends object> = (
  isExpanded: boolean,
  props: { keyName?: string | number; value?: T; parentValue?: T; keys: (number | string)[]; level: number },
) => boolean;

export interface JsonViewProps<T extends object>
  extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
  /** This property contains your input JSON */
  value?: T;
  /** Define the root node name. @default undefined */
  keyName?: string | number;
  /** Whether sort keys through `String.prototype.localeCompare()` @default false */
  objectSortKeys?: boolean | ((keyA: string, keyB: string, valueA: T, valueB: T) => number);
  /** Set the indent-width for nested objects @default 15 */
  indentWidth?: number;
  /** When set to `true`, `objects` and `arrays` are labeled with size @default true */
  displayObjectSize?: boolean;
  /** When set to `true`, data type labels prefix values @default true */
  displayDataTypes?: boolean;
  /** The user can copy objects and arrays to clipboard by clicking on the clipboard icon. @default true */
  enableClipboard?: boolean;
  /**
   * When set to true, all nodes will be collapsed by default. Use an integer value to collapse at a specific depth. @default false
   * collapsed takes precedence over shouldExpandNodeInitially.
   * @see {@link shouldExpandNodeInitially} for more details on how the initial expansion works.
   */
  collapsed?: boolean | number;
  /**
   * Determines whether the node should be expanded on the first render, or you can use collapsed to control the level of expansion (by default, the root is expanded).
   * If both collapsed and shouldExpandNodeInitially are set, the value of collapsed takes precedence.
   * @see {@link collapsed} for more details on how this works.
   */
  shouldExpandNodeInitially?: ShouldExpandNodeInitially<T>;
  /** Whether to highlight updates. @default true */
  highlightUpdates?: boolean;
  /** Shorten long JSON strings, Set to `0` to disable this feature @default 30 */
  shortenTextAfterLength?: number;
  /** When the text exceeds the length, `...` will be displayed. Currently, this `...` can be customized. @default "..." */
  stringEllipsis?: number;
  /** Callback function for when a treeNode is expanded or collapsed */
  onExpand?: (props: { expand: boolean; value?: T; keyid: string; keyName?: string | number }) => void;
  /** Fires event when you copy */
  onCopied?: (text: string, value?: T) => void;
  /** Transform the text before copying to clipboard */
  beforeCopy?: (
    copyText: string,
    keyName?: string | number,
    value?: T,
    parentValue?: T,
    expandKey?: string,
    keys?: (number | string)[],
  ) => string;
}

type JsonViewComponent = React.FC<React.PropsWithRef<JsonViewProps<object>>> & {
  Bigint: typeof Bigint;
  Date: typeof Date;
  False: typeof False;
  Float: typeof Float;
  Int: typeof Int;
  Map: typeof Map;
  Nan: typeof Nan;
  Null: typeof Null;
  Set: typeof Set;
  String: typeof StringText;
  True: typeof True;
  Undefined: typeof Undefined;
  Url: typeof Url;
  // Symbol
  BraceLeft: typeof BraceLeft;
  BraceRight: typeof BraceRight;
  BracketsLeft: typeof BracketsLeft;
  BracketsRight: typeof BracketsRight;

  Colon: typeof Colon;
  Ellipsis: typeof Ellipsis;
  Quote: typeof Quote;
  ValueQuote: typeof ValueQuote;
  Arrow: typeof Arrow;

  Copied: typeof Copied;
  CountInfo: typeof CountInfo;
  CountInfoExtra: typeof CountInfoExtra;
  KeyName: typeof KeyName;
  Row: typeof Row;
};

export const JsonView: JsonViewComponent = React.forwardRef<HTMLDivElement, JsonViewProps<object>>((props, ref) => {
  const {
    className = '',
    style,
    value,
    children,
    collapsed = false,
    shouldExpandNodeInitially = () => true,
    indentWidth = 15,
    displayObjectSize = true,
    shortenTextAfterLength = 30,
    stringEllipsis,
    highlightUpdates = true,
    enableClipboard = true,
    displayDataTypes = true,
    objectSortKeys = false,
    onExpand,
    onCopied,
    beforeCopy,
    ...elmProps
  } = props;
  const defaultStyle: CSS.Properties<string | number> = {
    lineHeight: 1.4,
    fontFamily: 'var(--w-rjv-font-family, Menlo, monospace)',
    color: 'var(--w-rjv-color, #002b36)',
    backgroundColor: 'var(--w-rjv-background-color, #00000000)',
    fontSize: 13,
    ...style,
  };
  const cls = ['w-json-view-container', 'w-rjv', className].filter(Boolean).join(' ');
  return (
    <Provider
      initialState={{
        value,
        objectSortKeys,
        indentWidth,
        shouldExpandNodeInitially: collapsed === false ? shouldExpandNodeInitially : () => false,
        displayObjectSize,
        collapsed,
        enableClipboard,
        shortenTextAfterLength,
        stringEllipsis,
        highlightUpdates,
        onCopied,
        onExpand,
        beforeCopy,
      }}
      initialTypes={{ displayDataTypes }}
    >
      <Container value={value} {...elmProps} ref={ref} className={cls} style={defaultStyle} />
      {children}
    </Provider>
  );
}) as unknown as JsonViewComponent;

JsonView.Bigint = Bigint;
JsonView.Date = Date;
JsonView.False = False;
JsonView.Float = Float;
JsonView.Int = Int;
JsonView.Map = Map;
JsonView.Nan = Nan;
JsonView.Null = Null;
JsonView.Set = Set;
JsonView.String = StringText;
JsonView.True = True;
JsonView.Undefined = Undefined;
JsonView.Url = Url;

JsonView.ValueQuote = ValueQuote;
JsonView.Arrow = Arrow;
JsonView.Colon = Colon;
JsonView.Quote = Quote;
JsonView.Ellipsis = Ellipsis;
JsonView.BraceLeft = BraceLeft;
JsonView.BraceRight = BraceRight;
JsonView.BracketsLeft = BracketsLeft;
JsonView.BracketsRight = BracketsRight;

JsonView.Copied = Copied;
JsonView.CountInfo = CountInfo;
JsonView.CountInfoExtra = CountInfoExtra;
JsonView.KeyName = KeyName;
JsonView.Row = Row;

JsonView.displayName = 'JVR.JsonView';

export default JsonView;
