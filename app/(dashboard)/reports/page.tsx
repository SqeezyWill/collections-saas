'use client';

import { useMemo, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency } from '@/lib/utils';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const PAGE_SIZE = 1000;
const COLLECTOR_PAGE_SIZE = 15;

function isCurrentMonth(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function getKpiValueClass(value: string) {
  const length = value.length;

  if (length >= 16) {
    return 'mt-2 whitespace-nowrap text-xl font-semibold leading-tight tracking-tight text-slate-900';
  }

  if (length >= 13) {
    return 'mt-2 whitespace-nowrap text-2xl font-semibold leading-tight tracking-tight text-slate-900';
  }

  return 'mt-2 whitespace-nowrap text-3xl font-semibold leading-tight tracking-tight text-slate-900';
}

function downloadCsv(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;

  const headers = Object.keys(rows[0]);

  const escapeValue = (value: any) => {
    const stringValue = String(value ?? '');
    const escaped = stringValue.replace(/"/g, '""');
    return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
  };

  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeValue(row[header])).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

async function fetchAllRows(table: 'accounts' | 'payments' | 'ptps') {
  if (!supabase) return [];

  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = data ?? [];
    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return allRows;
}

export default function ReportsPageWrapper() {
  return <ReportsPageClient />;
}

function ReportsPageClient() {
  const [reportData, setReportData] = useState<{
    accounts: any[];
    payments: any[];
    ptps: any[];
    loaded: boolean;
    error: string | null;
  }>({
    accounts: [],
    payments: [],
    ptps: [],
    loaded: false,
    error: null,
  });

  const [collectorPage, setCollectorPage] = useState(1);

  useMemo(() => {
    if (reportData.loaded || reportData.error) return;

    (async () => {
      if (!supabase) {
        setReportData({
          accounts: [],
          payments: [],
          ptps: [],
          loaded: true,
          error: 'Supabase is not configured.',
        });
        return;
      }

      try {
        const [accounts, payments, ptps] = await Promise.all([
          fetchAllRows('accounts'),
          fetchAllRows('payments'),
          fetchAllRows('ptps'),
        ]);

        setReportData({
          accounts,
          payments,
          ptps,
          loaded: true,
          error: null,
        });
      } catch (error: any) {
        setReportData({
          accounts: [],
          payments: [],
          ptps: [],
          loaded: true,
          error: error?.message || 'Unknown error',
        });
      }
    })();
  }, [reportData.loaded, reportData.error]);

  if (!reportData.loaded) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Reports</h1>
        <p className="text-slate-500">Loading reports...</p>
      </div>
    );
  }

  if (reportData.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Reports</h1>
        <p className="text-red-600">Failed to load report data: {reportData.error}</p>
      </div>
    );
  }

  const { accounts, payments, ptps } = reportData;

  const totalBalance = accounts.reduce(
    (sum, item) => sum + Number(item.balance || 0),
    0
  );

  const totalCollected = payments.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  const collectedThisMonth = payments
    .filter((item) => isCurrentMonth(item.paid_on))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const openPtps = ptps.filter((item) => item.status === 'Promise To Pay').length;

  const keptPtps = ptps.filter(
    (item) => item.resolution_type === 'kept'
  ).length;

  const brokenPtps = ptps.filter(
    (item) => item.resolution_type === 'broken'
  ).length;

  const resolvedPtps = ptps.filter(
    (item) => item.resolution_type === 'kept' || item.resolution_type === 'broken'
  ).length;

  const ptpKeptRate = resolvedPtps > 0 ? (keptPtps / resolvedPtps) * 100 : 0;
  const ptpConversionRate = ptps.length > 0 ? (keptPtps / ptps.length) * 100 : 0;

  const callbackAccounts = accounts.filter(
    (item) => item.status === 'Callback Requested'
  ).length;

  const productRows = Array.from(
    new Set(accounts.map((item) => item.product).filter(Boolean))
  )
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((product) => {
      const productAccounts = accounts.filter((item) => item.product === product);
      const productPayments = payments.filter((item) => item.product === product);

      return {
        product,
        accounts: productAccounts.length,
        balance: productAccounts.reduce(
          (sum, item) => sum + Number(item.balance || 0),
          0
        ),
        collected: productPayments.reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0
        ),
        collectedThisMonth: productPayments
          .filter((item) => isCurrentMonth(item.paid_on))
          .reduce((sum, item) => sum + Number(item.amount || 0), 0),
      };
    });

  const statuses = Array.from(
    new Set(accounts.map((item) => item.status).filter(Boolean))
  ).sort((a, b) => String(a).localeCompare(String(b)));

  const statusRows = statuses.map((status) => {
    const filtered = accounts.filter((item) => item.status === status);

    return {
      status,
      count: filtered.length,
      balance: filtered.reduce((sum, item) => sum + Number(item.balance || 0), 0),
    };
  });

  const collectors = Array.from(
    new Set(accounts.map((item) => item.collector_name).filter(Boolean))
  ).sort((a, b) => String(a).localeCompare(String(b)));

  const collectorRows = collectors.map((collector) => {
    const collectorAccounts = accounts.filter(
      (item) => item.collector_name === collector
    );
    const collectorPayments = payments.filter(
      (item) => item.collector_name === collector
    );
    const collectorPtps = ptps.filter((item) => item.collector_name === collector);

    const collectorKeptPtps = collectorPtps.filter(
      (item) => item.resolution_type === 'kept'
    ).length;

    const collectorBrokenPtps = collectorPtps.filter(
      (item) => item.resolution_type === 'broken'
    ).length;

    const collectorResolvedPtps = collectorPtps.filter(
      (item) => item.resolution_type === 'kept' || item.resolution_type === 'broken'
    ).length;

    const collected = collectorPayments.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0
    );

    const accountsCount = collectorAccounts.length;

    return {
      collector,
      accounts: accountsCount,
      balance: collectorAccounts.reduce(
        (sum, item) => sum + Number(item.balance || 0),
        0
      ),
      collected,
      collectedThisMonth: collectorPayments
        .filter((item) => isCurrentMonth(item.paid_on))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0),
      openPtps: collectorPtps.filter(
        (item) => item.status === 'Promise To Pay'
      ).length,
      keptPtps: collectorKeptPtps,
      brokenPtps: collectorBrokenPtps,
      ptpKeptRate:
        collectorResolvedPtps > 0
          ? formatPercent((collectorKeptPtps / collectorResolvedPtps) * 100)
          : '0.0%',
      callbacks: collectorAccounts.filter(
        (item) => item.status === 'Callback Requested'
      ).length,
      avgCollectedPerAccount: accountsCount > 0 ? collected / accountsCount : 0,
    };
  });

  const totalCollectorPages = Math.max(
    1,
    Math.ceil(collectorRows.length / COLLECTOR_PAGE_SIZE)
  );

  const pagedCollectorRows = collectorRows.slice(
    (collectorPage - 1) * COLLECTOR_PAGE_SIZE,
    collectorPage * COLLECTOR_PAGE_SIZE
  );

  function handleDownloadCollectorReport() {
    downloadCsv(
      'collector-performance-report.csv',
      collectorRows.map((row) => ({
        Collector: row.collector,
        Accounts: row.accounts,
        Balance: row.balance,
        'Collected To Date': row.collected,
        'Collected This Month': row.collectedThisMonth,
        'Open PTPs': row.openPtps,
        'Kept PTPs': row.keptPtps,
        'Broken PTPs': row.brokenPtps,
        'PTP Kept Rate': row.ptpKeptRate,
        Callbacks: row.callbacks,
        'Average Collected Per Account': row.avgCollectedPerAccount.toFixed(2),
      }))
    );
  }

  function handleDownloadProductReport() {
    downloadCsv(
      'product-breakdown-report.csv',
      productRows.map((row) => ({
        Product: row.product,
        Accounts: row.accounts,
        Balance: row.balance,
        'Collected To Date': row.collected,
        'Collected This Month': row.collectedThisMonth,
      }))
    );
  }

  function handleDownloadStatusReport() {
    downloadCsv(
      'status-breakdown-report.csv',
      statusRows.map((row) => ({
        Status: row.status,
        Accounts: row.count,
        Balance: row.balance,
      }))
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Reports</h1>
          <p className="mt-1 text-slate-500">
            Live reporting summary built from accounts, payments and PTP records.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleDownloadCollectorReport}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download Collector Report
          </button>
          <button
            onClick={handleDownloadProductReport}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download Product Report
          </button>
          <button
            onClick={handleDownloadStatusReport}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download Status Report
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Portfolio Balance</p>
          <p className={getKpiValueClass(currency(totalBalance))}>
            {currency(totalBalance)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Collected to Date</p>
          <p className={getKpiValueClass(currency(totalCollected))}>
            {currency(totalCollected)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Collected This Month</p>
          <p className={getKpiValueClass(currency(collectedThisMonth))}>
            {currency(collectedThisMonth)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Open PTPs</p>
          <p className={getKpiValueClass(String(openPtps))}>
            {openPtps}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Kept PTPs</p>
          <p className={getKpiValueClass(String(keptPtps))}>
            {keptPtps}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Broken PTPs</p>
          <p className={getKpiValueClass(String(brokenPtps))}>
            {brokenPtps}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">PTP Kept Rate</p>
          <p className={getKpiValueClass(formatPercent(ptpKeptRate))}>
            {formatPercent(ptpKeptRate)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Conversion: {formatPercent(ptpConversionRate)}
          </p>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="section-title">Product Breakdown</h2>
        </div>
        <DataTable
          headers={[
            'Product',
            'Accounts',
            'Balance',
            'Collected to Date',
            'Collected This Month',
          ]}
        >
          {productRows.map((row) => (
            <tr key={row.product}>
              <td className="px-4 py-3 font-medium">{row.product}</td>
              <td className="px-4 py-3">{row.accounts}</td>
              <td className="px-4 py-3">{currency(row.balance)}</td>
              <td className="px-4 py-3">{currency(row.collected)}</td>
              <td className="px-4 py-3">{currency(row.collectedThisMonth)}</td>
            </tr>
          ))}
        </DataTable>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-title">Status Breakdown</h2>
          </div>
          <DataTable headers={['Status', 'Accounts', 'Balance']}>
            {statusRows.map((row) => (
              <tr key={row.status}>
                <td className="px-4 py-3 font-medium">{row.status}</td>
                <td className="px-4 py-3">{row.count}</td>
                <td className="px-4 py-3">{currency(row.balance)}</td>
              </tr>
            ))}
          </DataTable>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="section-title">Collector Performance</h2>
            <p className="text-sm text-slate-500">
              Showing {(collectorPage - 1) * COLLECTOR_PAGE_SIZE + 1}-
              {Math.min(collectorPage * COLLECTOR_PAGE_SIZE, collectorRows.length)} of{' '}
              {collectorRows.length} agents
            </p>
          </div>

          <DataTable
            headers={[
              'Collector',
              'Accounts',
              'Balance',
              'Collected to Date',
              'Collected This Month',
              'Open PTPs',
              'Kept PTPs',
              'Broken PTPs',
              'PTP Kept Rate',
              'Callbacks',
              'Avg / Account',
            ]}
          >
            {pagedCollectorRows.map((row) => (
              <tr key={row.collector}>
                <td className="px-4 py-3 font-medium">{row.collector}</td>
                <td className="px-4 py-3">{row.accounts}</td>
                <td className="px-4 py-3">{currency(row.balance)}</td>
                <td className="px-4 py-3">{currency(row.collected)}</td>
                <td className="px-4 py-3">{currency(row.collectedThisMonth)}</td>
                <td className="px-4 py-3">{row.openPtps}</td>
                <td className="px-4 py-3">{row.keptPtps}</td>
                <td className="px-4 py-3">{row.brokenPtps}</td>
                <td className="px-4 py-3">{row.ptpKeptRate}</td>
                <td className="px-4 py-3">{row.callbacks}</td>
                <td className="px-4 py-3">
                  {currency(row.avgCollectedPerAccount)}
                </td>
              </tr>
            ))}
          </DataTable>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">
              Page {collectorPage} of {totalCollectorPages}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setCollectorPage((prev) => Math.max(1, prev - 1))}
                disabled={collectorPage === 1}
                className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                  collectorPage === 1
                    ? 'cursor-not-allowed border-slate-200 text-slate-300'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Previous
              </button>

              <button
                onClick={() =>
                  setCollectorPage((prev) => Math.min(totalCollectorPages, prev + 1))
                }
                disabled={collectorPage === totalCollectorPages}
                className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                  collectorPage === totalCollectorPages
                    ? 'cursor-not-allowed border-slate-200 text-slate-300'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Management Snapshot
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-sm text-slate-500">Callback Accounts</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {callbackAccounts}
            </p>
          </div>

          <div>
            <p className="text-sm text-slate-500">Portfolio Collection Rate</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {totalBalance + totalCollected > 0
                ? formatPercent((totalCollected / (totalBalance + totalCollected)) * 100)
                : '0.0%'}
            </p>
          </div>

          <div>
            <p className="text-sm text-slate-500">PTP Resolution Rate</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {resolvedPtps > 0
                ? formatPercent((resolvedPtps / ptps.length) * 100)
                : '0.0%'}
            </p>
          </div>

          <div>
            <p className="text-sm text-slate-500">Collectors in Report</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {collectorRows.length}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}