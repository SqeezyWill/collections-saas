import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';

function isToday(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

export default async function PtpsPage() {
  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const { data: rows, error } = await supabase
    .from('ptps')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="text-red-600">Failed to load PTPs: {error.message}</p>
      </div>
    );
  }

  const openPtps = (rows ?? []).filter(
    (row) => row.status === 'Promise To Pay'
  ).length;

  const keptPtps = (rows ?? []).filter((row) => row.status === 'Kept').length;
  const brokenPtps = (rows ?? []).filter((row) => row.status === 'Broken').length;

  const dueToday = (rows ?? []).filter(
    (row) => row.status === 'Promise To Pay' && isToday(row.promised_date)
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="mt-1 text-slate-500">
          Live promise-to-pay activity linked to account workspaces.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Open PTPs</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{openPtps}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Due Today</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{dueToday}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Kept PTPs</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{keptPtps}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Broken PTPs</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{brokenPtps}</p>
        </div>
      </div>

      <DataTable
        headers={[
          'Collector',
          'Product',
          'Promised Amount',
          'Promise Date',
          'Status',
          'Account ID',
          'Booked On',
        ]}
      >
        {(rows ?? []).map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.collector_name || '-'}</td>
            <td className="px-4 py-3">{row.product || '-'}</td>
            <td className="px-4 py-3">
              {currency(Number(row.promised_amount || 0))}
            </td>
            <td className="px-4 py-3">{formatDate(row.promised_date)}</td>
            <td className="px-4 py-3">{row.status}</td>
            <td className="px-4 py-3">{row.account_id || '-'}</td>
            <td className="px-4 py-3">{formatDate(row.created_at)}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}