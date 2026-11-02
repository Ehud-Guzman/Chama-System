// The fines reports, part: format. utils/fineReport.js is the index everything else requires.



// One member's fines, in full: what was issued, what has been paid off, what is
// still owed, and — kept deliberately — what was issued and later voided, because
// a report that quietly drops a wrong fine cannot be checked against the minutes
// that ordered it.
//
// Written for the disciplinary officer as much as for the office: he issues these
// fines, he is asked about them in a meeting, and until now the only record he
// could hand over was a screen.

const numberFmt = new Intl.NumberFormat('en-KE');

function money(amount) {
  return `Ksh ${numberFmt.format(Number(amount) || 0)}`;
}

function shortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

module.exports = {
  money,
  shortDate,
};
