import { money, shortDate } from '../../utils/format';
import MemberAvatar from '../../components/members/MemberAvatar';
import StatementPeriodPicker from '../../components/shared/StatementPeriodPicker';
import { Detail } from './shared';

export default function MemberSummaryCard({ admission, approvals, busy, children, declaration, emailStatement, emailing, exportStatement, exportStatementExcel, family, hasFamily, hasKin, hasPersonal, kin, ledger, member, onPhotoPicked, photoError, photoInputRef, photoUploading, removePhoto, setConfirmingResign, setEditing, statementPeriod, toggleEmailNotifications, totalContributed, uploadStatus }) {
  return (
    <section className="rounded-xl border border-rule bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <MemberAvatar name={member.name} photoUrl={member.photoUrl} size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold">
              {member.name}
              {!member.active && (
                <span className="ml-2 align-middle text-[11px] font-semibold uppercase tracking-widest text-alert">
                  Inactive
                </span>
              )}
            </h1>
            <p className="amount mt-1 text-sm text-muted">{member.phone}</p>
            {member.email && <p className="mt-0.5 truncate text-sm text-muted">{member.email}</p>}
            {member.regNumber && (
              <p className="amount text-xs uppercase tracking-widest text-muted">
                № {member.regNumber}
              </p>
            )}
            {member.notes && <p className="mt-2 text-sm text-muted">{member.notes}</p>}
          </div>
        </div>
        {/* Full width under the name on a phone, beside it once there is room: the
            lines this block carries are sentences, and a sentence in a narrow column
            is what pushes a header past the screen edge. */}
        <div className="w-full min-w-0 text-right sm:w-auto sm:shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Money held by member
          </p>
          <p className="amount text-xl font-bold text-accent">
            {money(ledger ? ledger.money : totalContributed)}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted">
            {ledger?.finesPaid > 0
              ? '(carried in + paid in − tea − fines paid out of his money)'
              : '(carried in + paid in − tea)'}
          </p>
          {ledger && (
            <p className="amount mt-1 text-xs text-muted">
              {money(ledger.openingBalance)} carried in at week {ledger.cycleStartWeek} ·{' '}
              {money(ledger.paid)} paid in since
            </p>
          )}
          {ledger && (ledger.chasedArrears ?? ledger.arrears) > 0 && (
            <p className="amount mt-1 text-xs font-semibold text-alert">
              {money(ledger.chasedArrears ?? ledger.arrears)} owed
              {(ledger.chasedWeeksBehind ?? ledger.weeksBehind) > 0
                ? ` (${ledger.chasedWeeksBehind ?? ledger.weeksBehind} week${
                    (ledger.chasedWeeksBehind ?? ledger.weeksBehind) === 1 ? '' : 's'
                  } behind)`
                : ''}
            </p>
          )}
          {/* Above the group's line: the money is still uncollected, but nothing is asked of him —
              said in the calm tone rather than the red one (utils/reminderLimit). */}
          {ledger && (ledger.chasedArrears ?? ledger.arrears) === 0 && ledger.arrears > 0 && (
            <p className="amount mt-1 text-xs font-semibold text-muted">
              Ahead of the cycle — {money(ledger.arrears)} of a closed week not collected
              {ledger.moneyLimit > 0 ? ` (he holds more than ${money(ledger.moneyLimit)})` : ''}
            </p>
          )}
        </div>
      </div>
      <dl className="mt-3 grid gap-3 border-t border-rule pt-3 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Member since
          </dt>
          <dd className="text-xs text-muted">
            {shortDate(member.joinDate || member.createdAt)}
          </dd>
        </div>

        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Email reminders
          </dt>
          <dd className="text-xs text-muted">
            {!member.email
              ? 'No email address on file'
              : member.emailNotifications === false
                ? 'Switched off for this member'
                : 'On — late contributions and fines'}
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-rule pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Next of kin {hasKin ? `(${kin.length})` : ''}
        </p>
        {hasKin ? (
          <ul className="mt-1 space-y-1.5">
            {kin.map((person, index) => (
              <li key={index} className="text-sm">
                <span className="font-medium">{person.name}</span>
                {person.relationship ? ` (${person.relationship})` : ''}
                {person.phone && (
                  <span className="amount block text-xs text-muted sm:inline"> · {person.phone}</span>
                )}
                {person.email && (
                  <span className="block break-words text-xs text-muted sm:inline">
                    {' '}
                    · {person.email}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Not recorded yet — add a spouse, the children or the in-laws via Edit.
          </p>
        )}
      </div>

      {/* The member's own details beyond the name and the number, each block only as
          long as what is known: a member entered from a name and a number shows the
          prompt to fill him in, not a column of blanks. */}
      <div className="mt-3 border-t border-rule pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Personal details
        </p>
        {hasPersonal ? (
          <dl className="mt-1 grid gap-2 sm:grid-cols-3">
            <Detail label="Date of birth" value={member.dateOfBirth ? shortDate(member.dateOfBirth) : ''} />
            <Detail label="National ID / passport" value={member.nationalId} />
            <Detail label="Physical address" value={member.physicalAddress} />
          </dl>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Date of birth, ID number and address not recorded — add them via Edit.
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-rule pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">Family</p>
        {hasFamily ? (
          <dl className="mt-1 grid gap-2 sm:grid-cols-2">
            <Detail label="Spouse" value={family.spouseName} />
            <Detail label="Children" value={children.join(', ')} />
            <Detail label="Father" value={family.fatherName} />
            <Detail label="Mother" value={family.motherName} />
            <Detail label="Father-in-law" value={family.fatherInLawName} />
            <Detail label="Mother-in-law" value={family.motherInLawName} />
          </dl>
        ) : (
          <p className="mt-1 text-xs text-muted">
            No family recorded — add a spouse, the children or the parents via Edit.
          </p>
        )}
      </div>

      <div className="mt-3 border-t border-rule pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Admission
        </p>
        <dl className="mt-1 grid gap-2 sm:grid-cols-2">
          <Detail label="Declaration" value={declaration} />
          <Detail
            label="Approved by"
            value={
              approvals.length > 0
                ? approvals
                    .map((approval) => `${approval.name} (${approval.role})`)
                    .join(', ')
                : ''
            }
          />
        </dl>
        {approvals.length > 0 && (
          <ul className="mt-1 space-y-1">
            {approvals.map((approval) => (
              <li key={approval.role} className="text-xs text-muted">
                <span className="font-medium capitalize">{approval.role}</span> · {approval.name} ·{' '}
                {shortDate(approval.signedAt)}
              </li>
            ))}
          </ul>
        )}
        {!admission.complete && (
          <p className="mt-1 text-xs text-muted">
            Pending{admission.missing?.length ? ` — waiting on the ${admission.missing.join(', ')}` : ''}.
            {' '}Record the signatures via Edit.
          </p>
        )}
      </div>

      {member.resignedAt && (
        <p className="mt-3 border-t border-rule pt-3 text-xs text-alert">
          Resigned {shortDate(member.resignedAt)}
          {member.resignationReason ? ` — ${member.resignationReason}` : ''}
          {member.resignationSettlement ? ` · Settled: ${member.resignationSettlement}` : ''}
        </p>
      )}

      {/* A member who has left is read as at the day he left, and the page says so: otherwise the
          figures below look like they stopped by accident. */}
      {ledger?.endedAt && (
        <p className="mt-2 text-xs text-muted">
          His figures stop on {shortDate(ledger.endedAt)}, the day he was made inactive. Nothing is charged to
          him after it.
        </p>
      )}

      {/* Profile photo and the reminder switch. Both write to the server the
          moment they are used rather than routing the admin back through the
          edit form, and the picker stays disabled with an explanation when the
          server has no image-storage keys configured. */}
      <div className="mt-3 space-y-2 border-t border-rule pt-3">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          onChange={onPhotoPicked}
          className="hidden"
          aria-label="Member profile photo"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={photoUploading || uploadStatus?.cloudinaryConfigured === false}
            className="min-h-11 rounded-lg border border-rule px-3 text-xs font-medium disabled:opacity-50"
          >
            {photoUploading ? 'Uploading…' : member.photoUrl ? 'Change photo' : 'Upload photo'}
          </button>

          {member.photoUrl && (
            <button
              type="button"
              onClick={removePhoto}
              disabled={busy || photoUploading}
              className="min-h-11 rounded-lg border border-rule px-3 text-xs font-medium text-alert disabled:opacity-50"
            >
              Remove photo
            </button>
          )}

          {member.email && (
            <button
              type="button"
              onClick={toggleEmailNotifications}
              disabled={busy}
              className="min-h-11 rounded-lg border border-rule px-3 text-xs font-medium disabled:opacity-50"
            >
              {member.emailNotifications === false
                ? 'Turn email reminders on'
                : 'Turn email reminders off'}
            </button>
          )}
        </div>

        {uploadStatus?.cloudinaryConfigured === false && (
          <p className="text-xs text-muted">
            Photo storage is not set up on the server yet, so photos are switched off.
          </p>
        )}

        {photoError && (
          <p className="text-xs text-alert" role="alert">
            {photoError}
          </p>
        )}
      </div>

      {/* Two per row on a phone. Four buttons across a 300px card left each one
          about 76px wide with no padding, so "Resign member" wrapped onto two
          lines and the label touched the border. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
        >
          Edit
        </button>

        <button
          type="button"
          onClick={exportStatement}
          className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
        >
          Statement PDF
        </button>

        <button
          type="button"
          onClick={exportStatementExcel}
          className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium"
        >
          Statement Excel
        </button>

        {/* His own copy, as a PDF, to the address on his record, for the period chosen below. */}
        <button
          type="button"
          onClick={emailStatement}
          disabled={emailing || !member.email}
          title={member.email ? `Send to ${member.email}` : 'There is no email address on his record'}
          className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium disabled:opacity-50"
        >
          {emailing ? 'Sending…' : 'Email statement'}
        </button>

        {/* Both statement buttons download whatever period is chosen here. The picker sits in the
            action row rather than under the figures because it is an argument to those two
            buttons, not a fact about the member. Its width is the grid column's: a minimum
            width here (13rem was tried) outgrows the column on a tablet and pushes the page
            sideways, so the select shrinks with the row instead. */}
        <StatementPeriodPicker
          className="min-w-0"
          idPrefix="office-period"
          preset={statementPeriod.preset}
          from={statementPeriod.from}
          to={statementPeriod.to}
          onChange={({ preset, from, to }) => {
            if (preset !== undefined) statementPeriod.setPreset(preset);
            if (from !== undefined) statementPeriod.setFrom(from);
            if (to !== undefined) statementPeriod.setTo(to);
          }}
        />

        {member.active && (
          <button
            type="button"
            onClick={() => setConfirmingResign(true)}
            className="min-h-11 rounded-lg border border-rule px-3 text-sm font-medium text-alert"
          >
            Resign member
          </button>
        )}
      </div>
    </section>
  );
}
