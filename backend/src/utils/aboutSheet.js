// Every export says what it is, who asked for it and when, as its first sheet. A
// workbook that turns up in a WhatsApp group a year later should be readable
// without anyone having to remember which screen it came from — and a figure with
// no stated scope is how two people end up arguing about the same report.
//
// Shared by every export in the app, not just the reports: the audit trail's own
// workbook has the same duty to say where it came from.
function aboutSheet({ name, settings, req, counts = [], notes = '' }) {
  return {
    name: 'About this export',
    rows: [
      { Field: 'Chama', Value: settings?.chamaName || '' },
      { Field: 'Report', Value: name },
      ...counts.map(([Field, Value]) => ({ Field, Value })),
      { Field: 'Generated on', Value: new Date() },
      { Field: 'Prepared by', Value: req.user?.name || '' },
      ...(notes ? [{ Field: 'What this counts', Value: notes }] : []),
    ],
  };
}

module.exports = { aboutSheet };
