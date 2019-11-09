import * as proto from 'tigon-proto';
import * as React from 'react';
import * as Model from '../../model';
import { AutoSizer, MultiGrid, GridCellProps, Index } from 'react-virtualized';

import './table.scss';

// // The table properties
// interface ITableProps {
//     data: Model.CoreBuffer<proto.duckdb.QueryResult>;
// }
// 
// // The table state
// interface ITableState {
//     width: number;
//     height: number;
// }
// 
// // The table
// class Table extends React.Component<ITableProps, ITableState> {
//     protected lastUpdate: number;
// 
//     // Constructor
//     constructor(props: ITableProps) {
//         super(props);
//         this.lastUpdate = props.data.timestamp;
//     }
// 
//     // Only update the component if the timestamp changes
//     public shouldComponentUpdate(nextProps: ITableProps, nextState: ITableState): boolean {
//         if (this.state === nextState &&
//             this.props === nextProps &&
//             this.lastUpdate === nextProps.data.timestamp) {
//             return false;
//         }
//         return true;
//     }
// 
//     // Render a single cell
//     public renderCell(props: GridCellProps) {
//         const cellBorder = '1px solid rgb(225, 225, 225)';
//         const fixedCellColor = 'rgb(245, 245, 245)';
// 
//         enum CellType {
//             Anchor,
//             ColumnHeader,
//             RowHeader,
//             Data
//         };
//         let cellType = CellType.Data;
// 
//         if (props.rowIndex === 0) {
//             if (props.columnIndex === 0) {
//                 cellType = CellType.Anchor;
//             } else {
//                 cellType = CellType.ColumnHeader;
//             }
//         } else if (props.columnIndex === 0) {
//             cellType = CellType.RowHeader
//         }
// 
//         switch (cellType) {
//             case CellType.Anchor:
//                 return (
//                     <div
//                         key={props.key}
//                         style={{
//                             ...props.style,
//                             backgroundColor: fixedCellColor,
//                             boxSizing: 'border-box',
//                             borderBottom: cellBorder,
//                             borderRight: cellBorder,
//                             textAlign: 'center',
//                             lineHeight: '28px',
//                         }}
//                     />
//                 );
//             case CellType.ColumnHeader:
//                 return (
//                     <div
//                         key={props.key}
//                         style={{
//                             ...props.style,
//                             backgroundColor: fixedCellColor,
//                             boxSizing: 'border-box',
//                             borderBottom: cellBorder,
//                             borderRight: cellBorder,
//                             textAlign: 'center',
//                             lineHeight: '28px',
//                         }}
//                     >
//                         {this.props.data.getColumn(props.columnIndex - 1).getName()}
//                     </div>
//                 );
//             case CellType.RowHeader:
//                 return (
//                     <div
//                         key={props.key}
//                         style={{
//                             ...props.style,
//                             backgroundColor: fixedCellColor,
//                             boxSizing: 'border-box',
//                             borderBottom: cellBorder,
//                             borderRight: cellBorder,
//                             textAlign: 'center',
//                             lineHeight: '28px',
//                         }}
//                     >
//                         {props.rowIndex}
//                     </div>
//                 );
//             case CellType.Data:
//             {
//                 let columnIndex = props.columnIndex - 1;
//                 let rowIndex = props.rowIndex - 1;
//                 return (
//                     <div
//                         key={props.key}
//                         style={{
//                             ...props.style,
//                             boxSizing: 'border-box',
//                             borderBottom: cellBorder,
//                             borderRight: cellBorder,
//                             lineHeight: '28px',
//                             padding: '0px 8px 0px 8px',
//                             backgroundColor: 'white',
//                         }}
//                     >
//                         {this.props.data.getColumn(columnIndex).getRowAsString(rowIndex)}
//                     </div>
//                 );
//             }
//         }
//     }
// 
//     // 
//     public computeColumnWidth(index: Index, totalWidth: number): number {
//         return 42;
//         // return index ? 50: ((totalWidth - 50) / this.props.data.getColumnCount());
//     }
// 
//     // Render the full table
//     public render() {
//         let columnCount = this.props.data.getColumnCount();
//         return (
//             <div className="table">
//                 <AutoSizer>
//                     {({ height, width }) => (
//                         <MultiGrid
//                             cellRenderer={this.renderCell.bind(this)}
//                             columnCount={columnCount + 1}
//                             columnWidth={function(index: Index) {
//                                 let lineNumberWidth = 48;
//                                 let available = width - lineNumberWidth;
//                                 let equalWidths = available / columnCount;
//                                 let maxWidth = available * 0.2;
//                                 let minWidth = 60;
//                                 return (index.index === 0)
//                                     ? lineNumberWidth
//                                     : Math.max(Math.min(equalWidths, maxWidth), minWidth);
//                             }}
//                             height={height}
//                             width={width}
//                             fixedRowCount={1}
//                             fixedColumnCount={1}
//                             rowCount={this.props.data.getRowCount() + 1}
//                             rowHeight={28}
//                         />
//                     )}
//                 </AutoSizer>
//             </div>
//         );
//     }
// }

export default () => <div />;

