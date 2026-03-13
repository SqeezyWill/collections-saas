import Link from 'next/link';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const TOP_TABLE_LIMIT = 15;

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

function toDateOnly(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function isPastDue(dateValue: string | null | undefined) {
  if (!dateValue) return false;
  const dateOnly = toDateOnly(dateValue);
  const today = toDateOnly(new Date().toISOString());
  return Boolean(dateOnly) && dateOnly < today;
}

function buildPageUrl(filter: string) {
  return filter ? `/ptps?filter=${encodeURIComponent(filter)}` : '/ptps';
}

function monthsAgoDate(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

type AgentSummaryRow = {
  collectorName: string;
  totalBooked: number;
  openPtps: number;
  keptPtps: number;
  brokenPtps: number;
  rebookedPtps: number;
  totalPromisedAmount: number;
  totalKeptAmount: number;
  keptRatePct: number;
};

export default async function PtpsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const resolved = searchParams ? await searchParams : {};
  const filter = typeof resolved?.filter === 'string' ? resolved.filter.trim() : '';

  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const { data: initialRows, error: initialError } = await supabase
    .from('ptps')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .order('created_at', { ascending: false });

  if (initialError) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="text-red-600">Failed to load PTPs: {initialError.message}</p>
      </div>
    );
  }

  const overdueOpenPtps = (initialRows ?? []).filter(
    (row) => row.status === 'Promise To Pay' && isPastDue(row.promised_date)
  );

  for (const ptp of overdueOpenPtps) {
    const bookedOn = toDateOnly(ptp.created_at);
    const promisedDate = toDateOnly(ptp.promised_date);

    const { data: paymentRows, error: paymentError } = await supabase
      .from('payments')
      .select('amount, paid_on')
      .eq('account_id', ptp.account_id);

    if (paymentError) continue;

    const paymentsWithinWindow = (paymentRows ?? []).filter((payment) => {
      const paidOn = toDateOnly(payment.paid_on);
      if (!paidOn) return false;
      return paidOn >= bookedOn && paidOn <= promisedDate;
    });

    const paidWithinWindow = paymentsWithinWindow.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0
    );

    const promisedAmount = Number(ptp.promised_amount || 0);
    const nextStatus = paidWithinWindow >= promisedAmount ? 'Kept' : 'Broken';
    const keptAmount = nextStatus === 'Kept' ? paidWithinWindow : 0;
    const nowIso = new Date().toISOString();

    await supabase
      .from('ptps')
      .update({
        status: nextStatus,
        resolved_at: nowIso,
        kept_amount: keptAmount,
        resolution_source: 'auto',
      })
      .eq('id', ptp.id)
      .eq('status', 'Promise To Pay');

    await supabase
      .from('accounts')
      .update({
        status: nextStatus,
        last_action_date: promisedDate || toDateOnly(nowIso),
      })
      .eq('id', ptp.account_id);
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

  const accountIds = Array.from(
    new Set((rows ?? []).map((row) => row.account_id).filter(Boolean))
  );

  const accountsById = new Map<
    string,
    { cfid: string | null; debtor_name: string | null; status: string | null }
  >();

  if (accountIds.length > 0) {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, cfid, debtor_name, status')
      .in('id', accountIds);

    for (const account of accounts ?? []) {
      accountsById.set(String(account.id), {
        cfid: account.cfid ?? null,
        debtor_name: account.debtor_name ?? null,
        status: account.status ?? null,
      });
    }
  }

  const allRows = (rows ?? []).map((row) => {
    const account = row.account_id ? accountsById.get(String(row.account_id)) : null;
    return {
      ...row,
      accountMeta: account ?? null,
    };
  });

  const openPtps = allRows.filter((row) => row.status === 'Promise To Pay').length;
  const keptPtps = allRows.filter((row) => row.status === 'Kept').length;
  const brokenPtps = allRows.filter((row) => row.status === 'Broken').length;

  const dueToday = allRows.filter(
    (row) => row.status === 'Promise To Pay' && isToday(row.promised_date)
  ).length;

  const filteredRows = allRows.filter((row) => {
    if (!filter) return true;
    if (filter === 'open') return row.status === 'Promise To Pay';
    if (filter === 'due-today') return row.status === 'Promise To Pay' && isToday(row.promised_date);
    if (filter === 'kept') return row.status === 'Kept';
    if (filter === 'broken') return row.status === 'Broken';
    return true;
  });

  const topRows = filteredRows.slice(0, TOP_TABLE_LIMIT);

  const filterLabel =
    filter === 'open'
      ? 'Open PTPs'
      : filter === 'due-today'
        ? 'Due Today'
        : filter === 'kept'
          ? 'Kept PTPs'
          : filter === 'broken'
            ? 'Broken PTPs'
            : '';

  // last 6 months report
  const sixMonthsAgo = monthsAgoDate(6);
  const reportRows = allRows.filter((row) => {
    const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
    return createdAt >= new Date(sixMonthsAgo).getTime();
  });

  const agentMap = new Map<string, AgentSummaryRow>();

  for (const row of reportRows) {
    const collectorName = String(row.collector_name || 'Unassigned').trim() || 'Unassigned';
    const current = agentMap.get(collectorName) || {
      collectorName,
      totalBooked: 0,
      openPtps: 0,
      keptPtps: 0,
      brokenPtps: 0,
      rebookedPtps: 0,
      totalPromisedAmount: 0,
      totalKeptAmount: 0,
      keptRatePct: 0,
    };

    current.totalBooked += 1;
    current.totalPromisedAmount += Number(row.promised_amount || 0);
    current.totalKeptAmount += Number(row.kept_amount || 0);

    if (row.status === 'Promise To Pay') current.openPtps += 1;
    if (row.status === 'Kept') current.keptPtps += 1;
    if (row.status === 'Broken') current.brokenPtps += 1;
    if (row.is_rebooked === true) current.rebookedPtps += 1;

    agentMap.set(collectorName, current);
  }

  const agentSummaries = Array.from(agentMap.values())
    .map((row) => {
      const resolved = row.keptPtps + row.brokenPtps;
      return {
        ...row,
        keptRatePct: resolved > 0 ? Number(((row.keptPtps / resolved) * 100).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => a.collectorName.localeCompare(b.collectorName));

  const teamResolved = keptPtps + brokenPtps;
  const teamSummary = {
    totalBooked: reportRows.length,
    openPtps: reportRows.filter((row) => row.status === 'Promise To Pay').length,
    keptPtps: reportRows.filter((row) => row.status === 'Kept').length,
    brokenPtps: reportRows.filter((row) => row.status === 'Broken').length,
    rebookedPtps: reportRows.filter((row) => row.is_rebooked === true).length,
    totalPromisedAmount: reportRows.reduce((sum, row) => sum + Number(row.promised_amount || 0), 0),
    totalKeptAmount: reportRows.reduce((sum, row) => sum + Number(row.kept_amount || 0), 0),
    keptRatePct: teamResolved > 0 ? Number(((keptPtps / teamResolved) * 100).toFixed(2)) : 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="mt-1 text-slate-500">
          Live promise-to-pay activity linked to account workspaces.
        </p>
        {filterLabel ? (
          <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
            Filter: {filterLabel}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href={buildPageUrl('')}
          className={`rounded-xl border px-4 py-2 text-sm font-medium ${
            !filter
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          All
        </Link>

        <Link
          href={buildPageUrl('open')}
          className={`rounded-xl border px-4 py-2 text-sm font-medium ${
            filter === 'open'
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Open
        </Link>

        <Link
          href={buildPageUrl('due-today')}
          className={`rounded-xl border px-4 py-2 text-sm font-medium ${
            filter === 'due-today'
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Due Today
        </Link>

        <Link
          href={buildPageUrl('kept')}
          className={`rounded-xl border px-4 py-2 text-sm font-medium ${
            filter === 'kept'
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Kept
        </Link>

        <Link
          href={buildPageUrl('broken')}
          className={`rounded-xl border px-4 py-2 text-sm font-medium ${
            filter === 'broken'
              ? 'border-slate-900 bg-slate-900 text-white'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Broken
        </Link>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Recent PTP Activity</h2>
            <p className="mt-1 text-sm text-slate-500">
              Showing {topRows.length} of {filteredRows.length} PTP records for the selected filter.
            </p>
          </div>
        </div>

        <DataTable
          headers={[
            'CFID',
            'Client Name',
            'Product',
            'Promised Amount',
            'PTP Booked',
            'Promise Date',
            'Status',
            'Booked On',
            'Collector',
          ]}
        >
          {topRows.map((row) => {
            const account = row.accountMeta;

            return (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium">{account?.cfid || '-'}</td>
                <td className="px-4 py-3">
                  {row.account_id ? (
                    <Link
                      href={`/accounts/${row.account_id}`}
                      className="font-medium text-slate-700 hover:text-slate-900 hover:underline"
                    >
                      {account?.debtor_name || 'Open Account'}
                    </Link>
                  ) : (
                    account?.debtor_name || '-'
                  )}
                </td>
                <td className="px-4 py-3">{row.product || '-'}</td>
                <td className="px-4 py-3">{currency(Number(row.promised_amount || 0))}</td>
                <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">{formatDate(row.promised_date)}</td>
                <td className="px-4 py-3">{row.status || '-'}</td>
                <td className="px-4 py-3">{formatDate(row.created_at)}</td>
                <td className="px-4 py-3">{row.collector_name || '-'}</td>
              </tr>
            );
          })}
        </DataTable>

        {topRows.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            No PTPs found for this filter.
          </div>
        ) : null}
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">PTP Performance Report — Last 6 Months</h2>
          <p className="mt-1 text-sm text-slate-500">
            Historical promise-to-pay performance for the whole team and by agent.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-8">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Booked</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{teamSummary.totalBooked}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Open</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{teamSummary.openPtps}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Kept</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{teamSummary.keptPtps}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Broken</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{teamSummary.brokenPtps}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Rebooked</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{teamSummary.rebookedPtps}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Promised</p>
            <p className="mt-2 text-base font-semibold text-slate-900">
              {currency(teamSummary.totalPromisedAmount)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Kept Amount</p>
            <p className="mt-2 text-base font-semibold text-slate-900">
              {currency(teamSummary.totalKeptAmount)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs text-slate-500">Kept Rate</p>
            <p className="mt-2 text-xl font-semibold text-slate-900">{teamSummary.keptRatePct}%</p>
          </div>
        </div>

        <DataTable
          headers={[
            'Agent',
            'Booked',
            'Open',
            'Kept',
            'Broken',
            'Rebooked',
            'Promised Amount',
            'Kept Amount',
            'Kept Rate',
          ]}
        >
          {agentSummaries.map((row) => (
            <tr key={row.collectorName}>
              <td className="px-4 py-3 font-medium">{row.collectorName}</td>
              <td className="px-4 py-3">{row.totalBooked}</td>
              <td className="px-4 py-3">{row.openPtps}</td>
              <td className="px-4 py-3">{row.keptPtps}</td>
              <td className="px-4 py-3">{row.brokenPtps}</td>
              <td className="px-4 py-3">{row.rebookedPtps}</td>
              <td className="px-4 py-3">{currency(row.totalPromisedAmount)}</td>
              <td className="px-4 py-3">{currency(row.totalKeptAmount)}</td>
              <td className="px-4 py-3">{row.keptRatePct}%</td>
            </tr>
          ))}
        </DataTable>

        {agentSummaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            No PTP history found in the last 6 months.
          </div>
        ) : null}
      </div>
    </div>
  );
}