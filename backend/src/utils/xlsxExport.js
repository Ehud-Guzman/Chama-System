const XLSX = require('xlsx');

// Formula-injection guard (CWE-1236): a member note, fine reason, etc. that
// starts with =, +, - or @ would run as a formula the moment an admin opens
// the file in Excel/Sheets. Prefixing a quote forces it to stay plain text.
const RISKY_LEADING_CHAR = /^[=+\-@]/;
function sanitizeCell(value) {
  return typeof value === 'string' && RISKY_LEADING_CHAR.test(value) ? `'${value}` : value;
}
function sanitizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, sanitizeCell(value)]));
}

// Streams an .xlsx workbook to `res` — for admin bulk exports (large row
// counts), where a real spreadsheet is more useful than a CSV/PDF.
// `sheets` = [{ name, rows }], rows is an array of plain objects; object keys
// become the header row.
function sendWorkbook(res, filename, sheets) {
  const workbook = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const worksheet = XLSX.utils.json_to_sheet(rows.map(sanitizeRow));
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
