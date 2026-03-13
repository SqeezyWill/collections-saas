'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency } from '@/lib/utils';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const FETCH_PAGE_SIZE = 1000;
const PAGE_SIZE = 15;

type Row = {
  collector: string;
  assignedAccounts: number;
  totalCollected: number;
  loanCollected: number;
  cardCollected: number;
  openPtps: number;
  keptPtps: number;
  brokenPtps: number;
  callbacksDueToday: number;
  overdueCallbacks: number;
  staleAccounts: number;
  keptRate: number;
};

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;

  const headers = Object.keys(rows[0] ?? {});
  const escape = (v: any) => {
    const s = String(v ?? '');
    const needsWrap = /[",\n]/.test(s);
    const escaped = s.replace(/"/g, '""');
    return needsWrap ? `"${escaped}"` : escaped;
  };

  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function toDateOnly(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function isToday(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const iso = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let date: Date;

  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    date = new Date(year, month - 1, day);
  } else {
    date = new Date(dateValue);
  }

  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function isPastDue(dateValue: string | null | undefined) {
  if (!dateValue) return false;
  const dateOnly = toDateOnly(dateValue);
  const today = toDateOnly(new Date().toISOString());
  return Boolean(dateOnly) && dateOnly < today;
}

function resolvePtpOutcomeFromPayments(
  ptp: any,
  payments: Array<{ amount: number | null; paid_on: string | null }>
) {
  const bookedOn = toDateOnly(ptp.created_at);
  const promisedDate = toDateOnly(ptp.promised_date);
  const promisedAmount = Number(ptp.promised_amount || 0);

  const paymentsWithinWindow = (payments ?? []).filter((payment) => {
    const paidOn = toDateOnly(payment.paid_on);
    if (!paidOn) return false;
    return paidOn >= bookedOn && paidOn <= promisedDate;
  });

  const paidWithinWindow = paymentsWithinWindow.reduce(
    (sum, payment) => sum + Number(payment.amount || 0),
    0
  );

  const effectiveStatus = paidWithinWindow >= promisedAmount ? 'Kept' : 'Broken';

  return {
    effectiveStatus,
    effectiveKeptAmount: effectiveStatus === 'Kept' ? paidWithinWindow : 0,
  };
}

async function fetchAllRows(table: 'accounts' | 'payments' | 'ptps') {
  if (!supabase) return [];

  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const to = from + FETCH_PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    allRows.push(...rows);

    if (rows.length < FETCH_PAGE_SIZE) break;
    from += FETCH_PAGE_SIZE;
  }

  return allRows;
}

export default function CollectorsPage() {
  const [page, setPage] = useState(1);

  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    accounts: any[];
    payments: any[];
    ptps: any[];
  }>({
    loading: true,
    error: null,
    accounts: [],
    payments: [],
    ptps: [],
  });

  useEffect(() => {
    (async () => {
      if (!supabase) {
        setState((s) => ({ ...s, loading: false, error: 'Supabase is not configured.' }));
        return;
      }

      try {
        const [accounts, payments, ptps] = await Promise.all([
          fetchAllRows('accounts'),
          fetchAllRows('payments'),
          fetchAllRows('ptps'),
        ]);

        setState({
          loading: false,
          error: null,
          accounts,
          payments,
          ptps,
        });
      } catch (e: any) {
        setState((s) => ({
          ...s,
          loading: false,
          error: e?.message || 'Failed to load collectors report data.',
        }));
      }
    })();
  }, []);

  const normalizedPtps = useMemo(() => {
    const paymentsByAccountId = new Map<
      string,
      Array<{ amount: number | null; paid_on: string | null; collector_name?: string | null }>
    >();

    for (const payment of state.payments) {
      const key = String(payment.account_id || '');
      if (!key) continue;

      const current = paymentsByAccountId.get(key) || [];
      current.push({
        amount: payment.amount ?? null,
        paid_on: payment.paid_on ?? null,
        collector_name: payment.collector_name ?? null,
      });
      paymentsByAccountId.set(key, current);
    }

    return state.ptps.map((ptp) => {
      const accountPayments = ptp.account_id
        ? paymentsByAccountId.get(String(ptp.account_id)) || []
        : [];

      let effectiveStatus = ptp.status || '-';
      let effectiveKeptAmount = Number(ptp.kept_amount || 0);

      const needsDerivedOutcome =
        ptp.status === 'Promise To Pay' && isPastDue(ptp.promised_date);

      const needsDerivedKeptAmount =
        ptp.status === 'Kept' && Number(ptp.kept_amount || 0) <= 0;

      if (needsDerivedOutcome || needsDerivedKeptAmount) {
        const derived = resolvePtpOutcomeFromPayments(ptp, accountPayments);

        if (needsDerivedOutcome) {
          effectiveStatus = derived.effectiveStatus;
        }

        if (ptp.status === 'Kept' || derived.effectiveStatus === 'Kept') {
          effectiveKeptAmount = derived.effectiveKeptAmount;
        }
      }

      return {
        ...ptp,
        effectiveStatus,
        effectiveKeptAmount,
      };
    });
  }, [state.ptps, state.payments]);

  const allRows: Row[] = useMemo(() => {
    const { accounts, payments } = state;

    const collectors = Array.from(
      new Set(accounts.map((a) => a.collector_name).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b)));

    return collectors.map((collector) => {
      const collectorAccounts = accounts.filter((a) => a.collector_name === collector);
      const collectorPayments = payments.filter((p) => p.collector_name === collector);
      const collectorPtps = normalizedPtps.filter((p) => p.collector_name === collector);

      const totalCollected = collectorPayments.reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0
      );

      const loanCollected = collectorPayments
        .filter((p) => String(p.product || '').toLowerCase().includes('loan'))
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const cardCollected = collectorPayments
        .filter((p) => String(p.product || '').toLowerCase().includes('card'))
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const openPtps = collectorPtps.filter((p) => p.effectiveStatus === 'Promise To Pay').length;
      const keptPtps = collectorPtps.filter((p) => p.effectiveStatus === 'Kept').length;
      const brokenPtps = collectorPtps.filter((p) => p.effectiveStatus === 'Broken').length;

      const resolved = keptPtps + brokenPtps;
      const keptRate = resolved > 0 ? (keptPtps / resolved) * 100 : 0;

      const callbacksDueToday = collectorAccounts.filter(
        (a) => a.status === 'Callback Requested' && isToday(a.next_action_date)
      ).length;

      const overdueCallbacks = collectorAccounts.filter(
        (a) => a.status === 'Callback Requested' && isPastDue(a.next_action_date)
      ).length;

      const staleAccounts = collectorAccounts.filter((a) => {
        if (!a.last_action_date) return true;
        const today = toDateOnly(new Date().toISOString());
        const lastAction = toDateOnly(a.last_action_date);
        if (!lastAction) return true;
        return lastAction < today && isPastDue(a.last_action_date);
      }).length;

      return {
        collector: String(collector),
        assignedAccounts: collectorAccounts.length,
        totalCollected,
        loanCollected,
        cardCollected,
        openPtps,
        keptPtps,
        brokenPtps,
        callbacksDueToday,
        overdueCallbacks,
        staleAccounts,
        keptRate: Number(keptRate.toFixed(1)),
      };
    });
  }, [state, normalizedPtps]);

  const totals = useMemo(() => {
    const totalCollectors = allRows.length;
    const totalAssigned = allRows.reduce((s, r) => s + Number(r.assignedAccounts || 0), 0);
    const totalCollected = allRows.reduce((s, r) => s + Number(r.totalCollected || 0), 0);
    const totalOpenPtps = allRows.reduce((s, r) => s + Number(r.openPtps || 0), 0);
    const totalBrokenPtps = allRows.reduce((s, r) => s + Number(r.brokenPtps || 0), 0);
    const totalCallbacksDueToday = allRows.reduce((s, r) => s + Number(r.callbacksDueToday || 0), 0);
    const totalOverdueCallbacks = allRows.reduce((s, r) => s + Number(r.overdueCallbacks || 0), 0);

    const weightedKeptRate =
      totalAssigned > 0
        ? allRows.reduce(
            (s, r) => s + Number(r.keptRate || 0) * Number(r.assignedAccounts || 0),
            0
          ) / totalAssigned
        : 0;

    const avgCollectedPerAssigned = totalAssigned > 0 ? totalCollected / totalAssigned : 0;

    return {
      totalCollectors,
      totalAssigned,
      totalCollected,
      totalOpenPtps,
      totalBrokenPtps,
      totalCallbacksDueToday,
      totalOverdueCallbacks,
      weightedKeptRate,
      avgCollectedPerAssigned,
    };
  }, [allRows]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return allRows.slice(start, start + PAGE_SIZE);
  }, [allRows, page]);

  function handleDownload() {
    const exportRows = allRows.map((r) => ({
      Collector: r.collector,
      'Assigned Accounts': r.assignedAccounts,
      'Total Collected': r.totalCollected,
      'Loan Collected': r.loanCollected,
      'Card Collected': r.cardCollected,
      'Open PTPs': r.openPtps,
      'Kept PTPs': r.keptPtps,
      'Broken PTPs': r.brokenPtps,
      'Callbacks Due Today': r.callbacksDueToday,
      'Overdue Callbacks': r.overdueCallbacks,
      'Stale Accounts': r.staleAccounts,
      'PTP Kept Rate (%)': r.keptRate,
      'Avg Collected per Assigned':
        r.assignedAccounts > 0 ? (r.totalCollected / r.assignedAccounts).toFixed(2) : '0.00',
    }));

    downloadCsv('collector-performance.csv', exportRows);
  }

  if (state.loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Collector Performance</h1>
        <p className="text-slate-500">Loading collectors report…</p>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Collector Performance</h1>
        <p className="text-red-600">{state.error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Collector Performance</h1>
          <p className="mt-1 text-slate-500">
            Per-agent productivity, assigned books, payments, and follow-up pressure.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/accounts?status=Callback%20Requested"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Callback Queue
          </Link>

          <Link
            href="/ptps?filter=broken"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Broken PTPs
          </Link>

          <button
            onClick={handleDownload}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:w-auto"
          >
            Download Report (CSV)
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Collectors</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totals.totalCollectors}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Assigned Accounts</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totals.totalAssigned}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Total Collected</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {currency(totals.totalCollected)}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Avg per assigned: {currency(totals.avgCollectedPerAssigned)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Open PTPs</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totals.totalOpenPtps}</p>
          <p className="mt-2 text-sm text-slate-500">
            Weighted kept rate: {totals.weightedKeptRate.toFixed(1)}%
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Broken PTPs</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totals.totalBrokenPtps}</p>
          <p className="mt-2 text-sm text-slate-500">Pressure points for intervention</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Callback Pressure</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totals.totalCallbacksDueToday}</p>
          <p className="mt-2 text-sm text-slate-500">
            Overdue callbacks: {totals.totalOverdueCallbacks}
          </p>
        </div>
      </div>

      <DataTable
        headers={[
          'Collector',
          'Assigned',
          'Total collected',
          'Loan collected',
          'Card collected',
          'Open PTPs',
          'Kept PTPs',
          'Broken PTPs',
          'Callbacks today',
          'Overdue callbacks',
          'Stale accounts',
          'PTP kept rate',
          'Avg / assigned',
        ]}
      >
        {pagedRows.map((row) => {
          const avg = row.assignedAccounts > 0 ? row.totalCollected / row.assignedAccounts : 0;

          return (
            <tr key={row.collector}>
              <td className="px-4 py-3 font-medium">{row.collector}</td>
              <td className="px-4 py-3">{row.assignedAccounts}</td>
              <td className="px-4 py-3">{currency(row.totalCollected)}</td>
              <td className="px-4 py-3">{currency(row.loanCollected)}</td>
              <td className="px-4 py-3">{currency(row.cardCollected)}</td>
              <td className="px-4 py-3">{row.openPtps}</td>
              <td className="px-4 py-3">{row.keptPtps}</td>
              <td className="px-4 py-3">{row.brokenPtps}</td>
              <td className="px-4 py-3">{row.callbacksDueToday}</td>
              <td className="px-4 py-3">{row.overdueCallbacks}</td>
              <td className="px-4 py-3">{row.staleAccounts}</td>
              <td className="px-4 py-3">{row.keptRate}%</td>
              <td className="px-4 py-3">{currency(avg)}</td>
            </tr>
          );
        })}
      </DataTable>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">
          Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, allRows.length)} of{' '}
          {allRows.length} collectors
        </p>

        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className={`rounded-xl border px-4 py-2 text-sm font-medium ${
              page === 1
                ? 'cursor-not-allowed border-slate-200 text-slate-300'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Previous
          </button>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className={`rounded-xl border px-4 py-2 text-sm font-medium ${
              page === totalPages
                ? 'cursor-not-allowed border-slate-200 text-slate-300'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}