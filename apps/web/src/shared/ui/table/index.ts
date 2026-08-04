export { type ColumnSpec, type ColStyleMap, toColumnDef } from './types'
export { useDataTable } from './use-data-table'
export {
  useRowRerank,
  useRerankSensors,
  type UseRowRerankOptions,
  type UseRowRerankResult,
} from './use-row-rerank'
export { useDragRowStyle } from './use-drag-row-style'
export { TableRow, type TableRowProps } from './table-row'
export { rankColumn, RankCell, RANK_COLUMN_WIDTH, RANK_COLUMN_MIN_WIDTH } from './rank-column'
export {
  DataTableFrame,
  type DataTableFrameProps,
  type DataTableFrameHeader,
} from './data-table-frame'
export {
  SelectableTable,
  type SelectableTableProps,
  type SelectableTableDnd,
  type RowSelection,
} from './selectable-table'
// Re-exported so grid pages get the column-descriptor type from the table barrel
// and never import `shared/ui/data-table-header` directly (frame is the only path).
export { type DataTableHeaderColumn } from '@/shared/ui/data-table-header'
