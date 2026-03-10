'use client';

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
  keptRate: number; // percentage number
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

  const allRows: Row[] = useMemo(() => {
    const { accounts, payments, ptps } = state;

    // Collectors from accounts is the “assigned book” source of truth.
    const collectors = Array.from(
      new Set(accounts.map((a) => a.collector_name).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b)));

    return collectors.map((collector) => {
      const collectorAccounts = accounts.filter((a) => a.collector_name === collector);
      const collectorPayments = payments.filter((p) => p.collector_name === collector);
      const collectorPtps = ptps.filter((p) => p.collector_name === collector);

      const totalCollected = collectorPayments.reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0
      );

      // Product split: best-effort using product strings (adjust if your product naming differs)
      const loanCollected = collectorPayments
        .filter((p) => String(p.product || '').toLowerCase().includes('loan'))
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const cardCollected = collectorPayments
        .filter((p) => String(p.product || '').toLowerCase().includes('card'))
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);

      const openPtps = collectorPtps.filter((p) => p.status === 'Promise To Pay').length;

      const kept = collectorPtps.filter((p) => p.resolution_type === 'kept').length;
      const broken = collectorPtps.filter((p) => p.resolution_type === 'broken').length;
      const resolved = kept + broken;

      const keptRate = resolved > 0 ? (kept / resolved) * 100 : 0;

      return {
        collector: String(collector),
        assignedAccounts: collectorAccounts.length,
        totalCollected,
        loanCollected,
        cardCollected,
        openPtps,
        keptRate: Number(keptRate.toFixed(1)),
      };
    });
  }, [state]);

  const totals = useMemo(() => {
    const totalCollectors = allRows.length;
    const totalAssigned = allRows.reduce((s, r) => s + Number(r.assignedAccounts || 0), 0);
    const totalCollected = allRows.reduce((s, r) => s + Number(r.totalCollected || 0), 0);
    const totalOpenPtps = allRows.reduce((s, r) => s + Number(r.openPtps || 0), 0);

    const weightedKeptRate =
      totalAssigned > 0
        ? allRows.reduce(
            (s, r) => s + (Number(r.keptRate || 0) * Number(r.assignedAccounts || 0)),
            0
          ) / totalAssigned
        : 0;

    const avgCollectedPerAssigned = totalAssigned > 0 ? totalCollected / totalAssigned : 0;

    return {
      totalCollectors,
      totalAssigned,
      totalCollected,
      totalOpenPtps,
      weightedKeptRate,
      avgCollectedPerAssigned,
    };
  }, [allRows]);

  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));

  // if the number of collectors changes (e.g. after load), clamp page
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
            Per-agent productivity, assigned books, payments, and PTP performance.
          </p>
        </div>

        <button
          onClick={handleDownload}
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 lg:w-auto"
        >
          Download Report (CSV)
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          <p className="text-sm text-slate-500">PTP Health</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totals.totalOpenPtps}</p>
          <p className="mt-2 text-sm text-slate-500">
            Weighted kept rate: {totals.weightedKeptRate.toFixed(1)}%
          </p>
        </div>
      </div>

      <DataTable
        headers={[
          'Collector',
          'Assigned accounts',
          'Total collected',
          'Loan collected',
          'Card collected',
          'Open PTPs',
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