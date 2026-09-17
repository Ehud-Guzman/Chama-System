import { Link } from 'react-router-dom';
import MemberLedgerList from '../components/ledger/MemberLedgerList';

// The treasurer's page: the shared member list, header and all, plus the one
// button that belongs only here. Everything else — the week line, the totals,
// the names — is rendered by MemberLedgerList, which the admin dashboard shows
// too, so all the logging screens are the same screens.
export default function FinanceLedger() {
  return (
    <MemberLedgerList
      showHeader
      action={
        <Link
          to="/admin/finance/setup"
          className="min-h-11 rounded-lg border border-rule bg-surface px-4 text-sm font-medium leading-[2.75rem]"
        >
          Setup
        </Link>
      }
    />
  );
}
