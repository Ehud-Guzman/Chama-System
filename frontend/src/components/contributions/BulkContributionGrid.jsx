import { useEffect, useMemo, useRef, useState } from 'react';
import api, { apiMessage } from '../../services/api';
import { useToast } from '../shared/Toast';
import ConfirmDialog from '../shared/ConfirmDialog';
import { money, todayISO, METHOD_LABELS } from '../../utils/format';

const METHODS = Object.keys(METHOD_LABELS);
// Cells the treasurer writes to mean "nothing new this week" rather than a
// number — clear the cell rather than leaving a stale default in it.
const ZERO_WORDS = new Set(['nil', 'paid', 'none', '-', '—', 'n/a']);

function cellKey(memberId, typeId) {
  return `${memberId}:${typeId}`;
}

function normalizeKey(s) {
  return String(s || '').trim().toLowerCase();
}

// Cells start pre-filled with each isWeekly type's default amount (e.g. 100
// for Chai) — the treasurer scans down and edits/clears rather than typing
// every cell from scratch.
function buildDefaultValues(members, types) {
  const initial = {};
  for (const m of members) {
    for (const t of types) {
      if (t.isWeekly && t.weeklyAmount > 0) {
        initial[cellKey(m._id, t._id)] = String(t.weeklyAmount);
      }
    }
  }
  return initial;
}

// Parses an uploaded spreadsheet shaped like the on-screen grid — one row
// per member, one column per contribution type — and returns which
// member/type cells it could confidently match, plus what it couldn't (so
// the admin can fix the file or the row/column name rather than have data
// silently dropped).
function parseWorkbook(XLSX, workbook, members, types) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  if (rows.length === 0) return { updates: {}, unmatchedRows: [], unmatchedColumns: [], matchedCells: 0 };

  const columnKeys = Object.keys(rows[0]);
  const nameKey = columnKeys.find((k) => /^name$/i.test(k.trim())) || columnKeys[0];
  const regKey = columnKeys.find((k) => /reg/i.test(k));

  const memberByName = new Map(members.map((m) => [normalizeKey(m.name), m]));
  const memberByReg = new Map(
    members.filter((m) => m.regNumber).map((m) => [normalizeKey(m.regNumber), m])
  );
  const typeByName = new Map(types.map((t) => [normalizeKey(t.name), t]));

  const typeColumns = columnKeys.filter((k) => k !== nameKey && k !== regKey);
  const matchedTypeColumns = new Map(
    typeColumns.filter((k) => typeByName.has(normalizeKey(k))).map((k) => [k, typeByName.get(normalizeKey(k))])
  );
  const unmatchedColumns = typeColumns.filter((k) => !matchedTypeColumns.has(k));

  const updates = {};
  const unmatchedRows = [];
  let matchedCells = 0;

  for (const row of rows) {
    const rawName = String(row[nameKey] ?? '').trim();
    if (!rawName) continue;
    const rawReg = regKey ? String(row[regKey] ?? '').trim() : '';
    const member =
      (rawReg && memberByReg.get(normalizeKey(rawReg))) || memberByName.get(normalizeKey(rawName));
    if (!member) {
      unmatchedRows.push(rawReg ? `${rawName} (${rawReg})` : rawName);
      continue;
    }

    for (const [col, type] of matchedTypeColumns) {
      const raw = row[col];
      const text = String(raw ?? '').trim();
      if (text === '') continue; // blank cell — leave whatever's already in the grid
      if (ZERO_WORDS.has(text.toLowerCase())) {
        updates[cellKey(member._id, type._id)] = '';
        continue;
      }
      const n = Number(text.replace(/[,\s]/g, ''));
      if (Number.isFinite(n) && n > 0) {
        updates[cellKey(member._id, type._id)] = String(n);
        matchedCells++;
      }
    }
  }

  return { updates, unmatchedRows, unmatchedColumns, matchedCells };
}

// One screen for a whole meeting: a row per active member, a column per
// contribution type, cells pre-filled with each isWeekly type's default
// amount (e.g. 100 for Chai). Scan down, edit or clear cells, submit once —
// mirrors the paper ledger's layout instead of one member at a time.
export default function BulkContributionGrid({ onLogged }) {
  const toast = useToast();
  const [members, setMembers] = useState([]);
  const [types, setTypes] = useState([]);
  const [values, setValues] = useState({}); // `${memberId}:${typeId}` -> string
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uploadResult, setUploadResult] = useState(null); // { matchedCells, unmatchedRows, unmatchedColumns }
  const [lastResult, setLastResult] = useState(null); // { created, skipped } from the last submit
  const fileInputRef = useRef(null);
  // Identifies this whole batch attempt — rotates only after a successful
  // submit, so retrying a failed/dropped request resolves each entry to the
  // one already logged instead of creating duplicates.
  const clientRequestIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    Promise.all([
      // limit matches the server's raised ceiling for this admin listing —
      // the grid needs every active member in one page, not just the first 100.
      api.get('/api/members', { params: { status: 'active', limit: 500 } }),
      api.get('/api/types'),
    ])
      .then(([membersRes, typesRes]) => {
        const activeMembers = membersRes.data.members;
        const activeTypes = typesRes.data.types;
        setMembers(activeMembers);
        setTypes(activeTypes);
        setValues(buildDefaultValues(activeMembers, activeTypes));
      })
      .catch((err) => toast(apiMessage(err, 'Could not load members/types'), 'error'))
      .finally(() => setLoading(false));
  }, [toast]);

  function setCell(memberId, typeId, raw) {
    setValues((prev) => ({ ...prev, [cellKey(memberId, typeId)]: raw }));
  }

  function fillColumn(type) {
    const amount = type.isWeekly && type.weeklyAmount > 0 ? String(type.weeklyAmount) : '';
    setValues((prev) => {
      const next = { ...prev };
      for (const m of members) next[cellKey(m._id, type._id)] = amount;
      return next;
    });
  }

  function clearColumn(typeId) {
    setValues((prev) => {
      const next = { ...prev };
      for (const m of members) next[cellKey(m._id, typeId)] = '';
      return next;
    });
  }

  function onFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        // Loaded on demand — xlsx is a large library, no reason to ship it
        // to everyone who just wants to fill the grid by hand.
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(event.target.result, { type: 'array' });
        const { updates, unmatchedRows, unmatchedColumns, matchedCells } = parseWorkbook(
          XLSX,
          workbook,
          members,
          types
        );
        setValues((prev) => ({ ...prev, ...updates }));
        setUploadResult({ matchedCells, unmatchedRows, unmatchedColumns });
        if (matchedCells === 0) {
          toast('No matching member/type cells found in that file', 'error');
        } else {
          toast(`Filled ${matchedCells} cell${matchedCells === 1 ? '' : 's'} from the spreadsheet`);
        }
      } catch (err) {
        toast('Could not read that file — is it a valid .xlsx/.csv?', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const entries = useMemo(() => {
    const list = [];
    for (const m of members) {
      for (const t of types) {
        const raw = values[cellKey(m._id, t._id)];
        const n = Number(String(raw || '').replace(/[,\s]/g, ''));
        if (Number.isFinite(n) && n > 0) {
          list.push({ memberId: m._id, typeId: t._id, amount: n, memberName: m.name, typeName: t.name });
        }
      }
    }
    return list;
  }, [values, members, types]);

  const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);
  const memberCount = new Set(entries.map((e) => e.memberId)).size;

  async function submit() {
    setBusy(true);
    try {
      const res = await api.post('/api/contributions/bulk', {
        date,
        method,
        note: note.trim(),
        entries: entries.map(({ memberId, typeId, amount }) => ({ memberId, typeId, amount })),
        clientRequestId: clientRequestIdRef.current,
      });
      toast(
        res.data.skipped?.length
          ? `Logged ${res.data.created}, skipped ${res.data.skipped.length} — see details below`
          : `Logged ${res.data.created} contributions`
      );
      setLastResult(res.data);
      // Next attempt is a fresh batch, not a retry of this one
      clientRequestIdRef.current = crypto.randomUUID();
      // Reset the grid back to defaults for the next meeting rather than
      // leaving this week's entries sitting in it — an untouched "Log all"
      // tap later would otherwise re-log everyone.
      setValues(buildDefaultValues(members, types));
      setNote('');
      setConfirming(false);
      onLogged?.();
    } catch (err) {
      toast(apiMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading members and types…</p>;
  if (members.length === 0) {
    return <p className="text-sm text-muted">No active members yet.</p>;
  }
  if (types.length === 0) {
    return <p className="text-sm text-muted">No contribution types yet — add one from the Dashboard first.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-rule bg-surface p-4">
        <div>
          <label htmlFor="bulk-date" className="mb-1 block text-xs font-medium">
            Date
          </label>
          <input
            id="bulk-date"
            type="date"
            max={todayISO()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 rounded-lg border border-rule px-3 text-sm"
          />
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-medium">Method</legend>
          <div className="flex gap-1">
            {METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                aria-pressed={method === m}
                className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
                  method === m ? 'border-primary bg-primary/10 text-primary' : 'border-rule text-muted'
                }`}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="min-w-40 flex-1">
          <label htmlFor="bulk-note" className="mb-1 block text-xs font-medium">
            Note <span className="font-normal text-muted">(applies to all entries)</span>
          </label>
          <input
            id="bulk-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-11 w-full rounded-lg border border-rule px-3 text-sm"
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium">Or upload a spreadsheet</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-11 rounded-lg border border-rule px-3 text-xs font-semibold text-primary"
          >
            Upload .xlsx / .csv
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={onFileSelected}
            className="hidden"
          />
        </div>
      </div>

      <p className="text-xs text-muted">
        Expected layout: one row per member (a "Name" column, optionally a "Reg" column), one
        column per contribution type using its exact name (e.g. "Chai"). Unmatched rows/columns
        are listed below rather than guessed at.
      </p>

      {uploadResult && (uploadResult.unmatchedRows.length > 0 || uploadResult.unmatchedColumns.length > 0) && (
        <div className="rounded-xl border border-alert/40 bg-alert/5 p-4 text-xs">
          <p className="font-semibold text-alert">Some rows/columns from the file weren't matched:</p>
          {uploadResult.unmatchedRows.length > 0 && (
            <p className="mt-1 text-muted">
              Unmatched members: {uploadResult.unmatchedRows.join(', ')}
            </p>
          )}
          {uploadResult.unmatchedColumns.length > 0 && (
            <p className="mt-1 text-muted">
              Unmatched columns (name doesn't match any contribution type): {uploadResult.unmatchedColumns.join(', ')}
            </p>
          )}
        </div>
      )}

      {lastResult?.skipped?.length > 0 && (
        <div className="rounded-xl border border-alert/40 bg-alert/5 p-4 text-xs">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold text-alert">
              {lastResult.skipped.length} entr{lastResult.skipped.length === 1 ? 'y' : 'ies'} skipped from the last submit:
            </p>
            <button
              type="button"
              onClick={() => setLastResult(null)}
              className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted"
            >
              Dismiss
            </button>
          </div>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {lastResult.skipped.map((s, i) => (
              <li key={i} className="text-muted">
                {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-rule">
              <th className="sticky left-0 z-10 min-w-40 bg-surface px-3 py-2 text-left text-xs font-semibold uppercase tracking-widest text-muted">
                Member
              </th>
              {types.map((t) => (
                <th key={t._id} className="min-w-32 border-l border-rule px-3 py-2 text-left">
                  <p className="text-xs font-semibold">{t.name}</p>
                  <p className="amount text-[10px] text-muted">
                    {t.isWeekly ? `${money(t.weeklyAmount)}/wk` : 'variable'}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => fillColumn(t)}
                      className="text-[10px] font-medium text-primary"
                    >
                      Fill all
                    </button>
                    <button
                      type="button"
                      onClick={() => clearColumn(t._id)}
                      className="text-[10px] font-medium text-muted"
                    >
                      Clear
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m._id} className="border-b border-rule last:border-b-0">
                <td className="sticky left-0 z-10 min-w-40 bg-surface px-3 py-2">
                  <p className="truncate font-medium">{m.name}</p>
                  {m.regNumber && <p className="amount text-xs text-muted">{m.regNumber}</p>}
                </td>
                {types.map((t) => (
                  <td key={t._id} className="border-l border-rule px-2 py-1.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={values[cellKey(m._id, t._id)] || ''}
                      onChange={(e) => setCell(m._id, t._id, e.target.value)}
                      placeholder="0"
                      aria-label={`${t.name} for ${m.name}`}
                      className="amount h-10 w-24 rounded-lg border border-rule px-2 text-sm"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-rule bg-surface p-4">
        <p className="text-sm text-muted">
          <span className="amount font-semibold text-primary">{entries.length} entries</span> across{' '}
          {memberCount} member{memberCount === 1 ? '' : 's'} — total{' '}
          <span className="amount font-semibold">{money(totalAmount)}</span>
        </p>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={entries.length === 0}
          className="min-h-12 rounded-xl bg-primary px-5 text-sm font-semibold text-white disabled:opacity-60"
        >
          Log all
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Log this week's contributions?"
        body={`${entries.length} entries across ${memberCount} member${memberCount === 1 ? '' : 's'}, totaling ${money(totalAmount)}.`}
        confirmLabel="Log all"
        busy={busy}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
