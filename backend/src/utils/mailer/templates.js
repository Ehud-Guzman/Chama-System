// Mail, part: templates. utils/mailer.js is the index everything else requires.

const { CHAMA_NAME } = require('../../data/branding');

// -----------------------------------------------------------------------------
// Reminder template
// -----------------------------------------------------------------------------

const money = (amount) => `Ksh ${Number(amount || 0).toLocaleString('en-KE')}`;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Late weeks arrive as [{ weekNumber, typeName, shortfall }] and pending fines
// as [{ reason, remaining }]. Both lists are plain text in the email body — no
// tables, so it renders identically in Gmail, Outlook and a phone's mail app.
function buildReminderEmail({ chamaName, member, lateWeeks = [], fines = [], note = '' }) {
  const firstName = String(member.name || '').split(' ')[0] || 'member';
  const finesTotal = fines.reduce((sum, f) => sum + (f.remaining || 0), 0);
  const lateTotal = lateWeeks.reduce((sum, w) => sum + (w.shortfall || 0), 0);
  const total = finesTotal + lateTotal;

  const lines = [`Hi ${firstName},`, '', `This is a reminder from ${chamaName}.`];

  if (lateWeeks.length > 0) {
    lines.push(
      '',
      `Outstanding weekly contributions (${money(lateTotal)}):`,
      ...lateWeeks.map(
        (w) => `  • Week ${w.weekNumber} — ${w.typeName}: ${money(w.shortfall)} short`
      )
    );
  }

  if (fines.length > 0) {
    lines.push(
      '',
      `Unpaid fines (${money(finesTotal)}):`,
      ...fines.map((f) => `  • ${f.reason || 'Fine'}: ${money(f.remaining)}`)
    );
  }

  if (total > 0) {
    lines.push('', `Total outstanding: ${money(total)}`);
  }

  if (note) {
    lines.push('', note);
  }

  lines.push('', `Thank you,`, `${chamaName}`);

  const text = lines.join('\n');
  const subject = lateWeeks.length > 0 && fines.length > 0
    ? `${chamaName}: contributions and fines still outstanding`
    : fines.length > 0
      ? `${chamaName}: fine payment outstanding`
      : `${chamaName}: contributions still outstanding`;

  const section = (heading, items) =>
    items.length === 0
      ? ''
      : `<p style="margin:16px 0 4px;font-weight:700">${escapeHtml(heading)}</p><ul style="margin:0;padding-left:18px">${items}</ul>`;

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>This is a reminder from <strong>${escapeHtml(chamaName)}</strong>.</p>
    ${section(
      `Outstanding weekly contributions — ${money(lateTotal)}`,
      lateWeeks.map(
        (w) =>
          `<li>Week ${escapeHtml(w.weekNumber)} — ${escapeHtml(w.typeName)}: <strong>${money(w.shortfall)}</strong> short</li>`
      )
    )}
    ${section(
      `Unpaid fines — ${money(finesTotal)}`,
      fines.map((f) => `<li>${escapeHtml(f.reason || 'Fine')}: <strong>${money(f.remaining)}</strong></li>`)
    )}
    ${total > 0 ? `<p style="margin:16px 0 0">Total outstanding: <strong>${money(total)}</strong></p>` : ''}
    ${note ? `<p style="margin:16px 0 0">${escapeHtml(note)}</p>` : ''}
    <p style="margin:16px 0 0">Thank you,<br>${escapeHtml(chamaName)}</p>
  </div>`;

  return { subject, text, html };
}

// -----------------------------------------------------------------------------
// Fine emails
// -----------------------------------------------------------------------------
//
// A fine is issued, or a fine is paid. Both are things the member has to be told: a
// fine he never heard about becomes an argument at the next meeting, and a payment
// that is never acknowledged is a payment he may make twice. These are the group's own
// fine records speaking — the same figures the fines screen shows — not a second
// version of them.
//
// The two messages share one shape (the group, the member's own name, the figure, the
// reason, what happens next), so a member reading them a fortnight apart recognises
// the second as the same conversation as the first.

function fineDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// One fine, just issued.
function buildFineIssuedEmail({ chamaName, member, fine = {} }) {
  const group = chamaName || CHAMA_NAME;
  const firstName = String(member?.name || '').split(' ')[0] || 'member';
  const typeName = fine.typeName || 'Fine';
  const reason = String(fine.reason || '').trim();
  const amount = Number(fine.amount) || 0;
  const remaining = Number(fine.remaining ?? amount) || 0;
  const issued = fineDate(fine.date);

  const lines = [
    `Hi ${firstName},`,
    '',
    `A fine has been recorded against you by ${group}.`,
    '',
    `  • ${typeName}${reason ? ` — ${reason}` : ''}: ${money(amount)}`,
    issued ? `  • Dated: ${issued}` : '',
    '',
    `What is still owed: ${money(remaining)}.`,
    '',
    'You can settle it at the next meeting, or by sending the amount to the group with',
    'the reference of this fine. If you believe it was recorded in error, speak to the',
    'office before paying.',
    '',
    'Thank you,',
    group,
  ];

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>A fine has been recorded against you by <strong>${escapeHtml(group)}</strong>.</p>
    <p style="margin:16px 0 4px;font-weight:700">${escapeHtml(typeName)}${
      reason ? ` — ${escapeHtml(reason)}` : ''
    }</p>
    <p style="margin:0">Amount: <strong>${money(amount)}</strong>${
      issued ? ` &middot; dated ${escapeHtml(issued)}` : ''
    }</p>
    <p style="margin:16px 0 0">Still owed: <strong>${money(remaining)}</strong></p>
    <p style="margin:16px 0 0">You can settle it at the next meeting, or by sending the amount to
    the group with the reference of this fine. If you believe it was recorded in error, speak to
    the office before paying.</p>
    <p style="margin:16px 0 0">Thank you,<br>${escapeHtml(group)}</p>
  </div>`;

  return {
    subject: `${group}: a fine of ${money(amount)} has been recorded`,
    text: lines.join('\n'),
    html,
  };
}

// A fine — or several, when one payment cleared more than one — just paid. One email
// per payment rather than per fine, because that is how the money arrived and how the
// member will remember it.
function buildFineSettledEmail({ chamaName, member, payments = [], totalPaid = 0, paidAt, note = '' }) {
  const group = chamaName || CHAMA_NAME;
  const firstName = String(member?.name || '').split(' ')[0] || 'member';
  const paid = Number(totalPaid) || payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const when = fineDate(paidAt);
  const outstanding = payments.reduce((sum, p) => sum + (Number(p.remaining) || 0), 0);

  const lines = [
    `Hi ${firstName},`,
    '',
    `Thank you — your fine payment has been received by ${group}.`,
    '',
    `  Amount paid: ${money(paid)}${when ? ` (${when})` : ''}`,
    ...payments.map(
      (p) =>
        `  • ${p.label || 'Fine'}: ${money(p.amount)}${
          Number(p.remaining) > 0 ? ` — ${money(p.remaining)} still owed` : ' — cleared'
        }`
    ),
    '',
    outstanding > 0
      ? `You still owe ${money(outstanding)} on the fine${payments.length === 1 ? '' : 's'} above.`
      : 'Nothing is outstanding on this fine.',
    note ? `\n${note}` : '',
    '',
    'Thank you,',
    group,
  ];

  const items = payments
    .map(
      (p) =>
        `<li>${escapeHtml(p.label || 'Fine')}: <strong>${money(p.amount)}</strong>${
          Number(p.remaining) > 0
            ? ` — ${money(p.remaining)} still owed`
            : ' — cleared'
        }</li>`
    )
    .join('');

  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Thank you — your fine payment has been received by <strong>${escapeHtml(group)}</strong>.</p>
    <p style="margin:16px 0 4px">Amount paid: <strong>${money(paid)}</strong>${
      when ? ` &middot; ${escapeHtml(when)}` : ''
    }</p>
    ${items ? `<ul style="margin:0;padding-left:18px">${items}</ul>` : ''}
    ${
      outstanding > 0
        ? `<p style="margin:16px 0 0">You still owe <strong>${money(outstanding)}</strong>.</p>`
        : '<p style="margin:16px 0 0">Nothing is outstanding on this fine.</p>'
    }
    ${note ? `<p style="margin:16px 0 0">${escapeHtml(note)}</p>` : ''}
    <p style="margin:16px 0 0">Thank you,<br>${escapeHtml(group)}</p>
  </div>`;

  return {
    subject: `${group}: fine payment of ${money(paid)} received`,
    text: lines.join('\n'),
    html,
  };
}

// The message that carries a password-reset link. Short on purpose: it says who asked, gives the
// link and how long it lasts, and tells somebody who did not ask that nothing has changed.
function buildPasswordResetEmail({ chamaName, name, link, minutes = 30 }) {
  const group = chamaName || CHAMA_NAME;
  const firstName = String(name || '').split(' ')[0] || 'there';
  const text = [
    `Hi ${firstName},`,
    '',
    `Somebody asked to reset the password for your ${group} account. To choose a new one, open this link within ${minutes} minutes:`,
    '',
    link,
    '',
    'If it was not you, ignore this message. Your password has not changed and the link stops working by itself.',
    '',
    group,
  ].join('\n');
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Somebody asked to reset the password for your <strong>${escapeHtml(group)}</strong> account.
    To choose a new one, use the button within ${minutes} minutes.</p>
    <p style="margin:20px 0"><a href="${escapeHtml(link)}" style="background:#166534;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Choose a new password</a></p>
    <p style="font-size:12px;color:#5c6b62">Or paste this into your browser:<br>${escapeHtml(link)}</p>
    <p>If it was not you, ignore this message. Your password has not changed and the link stops working by itself.</p>
    <p>${escapeHtml(group)}</p>
  </div>`;
  return { subject: `${group}: reset your password`, text, html };
}

// A short note to the super admin that something in the trail or at the sign-in page is worth a
// look. Plain on purpose, like the password-reset message: what happened, then where to look.
// The lines are built from names and figures the system wrote, but the sign-in ones contain text a
// stranger typed, so everything is escaped.
// A member's own statement, with the PDF attached. Written for the member: no figures in the body
// (they are in the attachment, which is the document that can be checked), and a plain line saying
// who to speak to if it looks wrong.
function buildStatementEmail({ chamaName, member, periodLabel }) {
  const group = chamaName || CHAMA_NAME;
  const firstName = String(member?.name || '').split(' ')[0] || 'member';
  const covers = periodLabel ? `It covers: ${periodLabel}.` : 'It covers everything up to today.';
  const lines = [
    `Hi ${firstName},`,
    '',
    `Your statement from ${group} is attached as a PDF.`,
    covers,
    '',
    'If anything on it does not match your own record, please speak to the office before',
    'the next meeting so it can be put right.',
    '',
    'Thank you,',
    group,
  ];
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    <p>Hi ${escapeHtml(firstName)},</p>
    <p>Your statement from <strong>${escapeHtml(group)}</strong> is attached as a PDF.<br>${escapeHtml(covers)}</p>
    <p>If anything on it does not match your own record, please speak to the office before the next meeting so it can be put right.</p>
    <p>Thank you,<br>${escapeHtml(group)}</p>
  </div>`;
  return { subject: `${group}: your statement`, text: lines.join('\n'), html };
}

function buildSecurityAlertEmail({ chamaName, subject, lines = [] }) {
  const group = chamaName || CHAMA_NAME;
  const text = [...lines, '', group].join('\n');
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1b2b24">
    ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n    ')}
    <p style="font-size:12px;color:#5c6b62">${escapeHtml(group)} · sent because you are the super admin. SECURITY_ALERTS=off switches these off.</p>
  </div>`;
  return { subject: `${group}: ${subject}`, text, html };
}

module.exports = {
  buildFineIssuedEmail,
  buildFineSettledEmail,
  buildPasswordResetEmail,
  buildReminderEmail,
  buildSecurityAlertEmail,
  buildStatementEmail,
};
