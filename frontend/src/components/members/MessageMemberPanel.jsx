import { useState } from 'react';
import { whatsappLink, mailtoLink } from '../../utils/messaging';
import { money } from '../../utils/format';

function defaultMessage(member, pendingFinesTotal) {
  const lines = [`Hi ${member.name.split(' ')[0]}, this is a reminder from the chama.`];
  if (pendingFinesTotal > 0) {
    lines.push(`You currently have ${money(pendingFinesTotal)} in unpaid fines.`);
  }
  return lines.join(' ');
}

// Quick-send WhatsApp/email — opens the admin's own WhatsApp/email app with
// the message pre-filled. No account, API key, or cost involved; the admin
// still has to actually hit send themselves.
export default function MessageMemberPanel({ member, pendingFinesTotal = 0 }) {
  const [message, setMessage] = useState(() => defaultMessage(member, pendingFinesTotal));
  const [subject, setSubject] = useState('A message from the chama');

  return (
    <section className="rounded-xl border border-rule bg-surface p-4">
      <p className="text-sm font-semibold">Message {member.name.split(' ')[0]}</p>
      <label htmlFor="msg-subject" className="mt-3 block text-xs font-medium text-muted">
        Subject (email only)
      </label>
      <input
        id="msg-subject"
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="mt-1 h-11 w-full rounded-lg border border-rule px-3 text-sm"
      />
      <label htmlFor="msg-body" className="mt-3 block text-xs font-medium text-muted">
        Message
      </label>
      <textarea
        id="msg-body"
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="mt-1 w-full rounded-lg border border-rule px-3 py-2 text-sm"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={whatsappLink(member.phone, message)}
          target="_blank"
          rel="noreferrer"
          className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          Open in WhatsApp
        </a>
        {member.email ? (
          <a
            href={mailtoLink(member.email, subject, message)}
            className="min-h-11 rounded-lg border border-rule px-4 py-2 text-sm font-semibold"
          >
            Open in Email
          </a>
        ) : (
          <span className="flex min-h-11 items-center rounded-lg border border-dashed border-rule px-4 py-2 text-xs text-muted">
            No email on file
          </span>
        )}
      </div>
    </section>
  );
}
