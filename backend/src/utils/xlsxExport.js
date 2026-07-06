const XLSX = require('xlsx');

// Streams an .xlsx workbook to `res` — for admin bulk exports (large row
// counts), where a real spreadsheet is more useful than a CSV/PDF.
// `sheets` = [{ name, rows }], rows is an array of plain objects; object keys
// become the header row.
function sendWorkbook(res, filename, sheets) {
  const workbook = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const colCount = rows.length > 0 ? Object.keys(rows[0]).length : 0;
    worksheet['!cols'] = Array.from({ length: colCount }, () => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
  }
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

module.exports = { sendWorkbook };
