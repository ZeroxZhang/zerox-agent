import type { RenderedOutputPart } from "../../chatOutputModel";

type TablePart = Extract<RenderedOutputPart, { type: "table" }>;

type DataTableViewProps = {
  part: TablePart;
};

export function DataTableView({ part }: DataTableViewProps) {
  const columnCount = Math.max(
    1,
    part.columns.length,
    ...part.rows.map((row) => row.length),
  );
  const columns = Array.from(
    { length: columnCount },
    (_item, index) => part.columns[index] ?? "",
  );

  return (
    <div className="chat-data-table-wrap">
      <table className="chat-data-table">
        {part.caption ? <caption>{part.caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th key={`${column}-${index}`} scope="col">
                {column || `Column ${index + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {part.rows.map((row, rowIndex) => (
            <tr key={`${part.id}-row-${rowIndex}`}>
              {columns.map((_column, cellIndex) => (
                <td key={`${part.id}-cell-${rowIndex}-${cellIndex}`}>
                  {row[cellIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
