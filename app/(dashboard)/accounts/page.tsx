import Link from 'next/link';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

type AccountsPageProps = {
  searchParams?: Promise<{
    search?: string;
    collector?: string;
    status?: string;
    minBalance?: string;
    maxBalance?: string;
    lastActionFrom?: string;
    lastActionTo?: string;
    limit?: string;
    page?: string;
    columns?: string | string[];
    filter?: string;
  }>;
};

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';

const AVAILABLE_COLUMNS = [
  { key: 'cfid', label: 'CFID' },
  { key: 'debtor_name', label: 'Debtor' },
  { key: 'phone', label: 'Phone' },
  { key: 'account_no', label: 'Account' },
  { key: 'product', label: 'Product Name' },
  { key: 'product_code', label: 'Product Category' },
  { key: 'collector_name', label: 'Collector' },
  { key: 'balance', label: 'Balance' },
  { key: 'amount_paid', label: 'Amount paid' },
  { key: 'status', label: 'Status' },
  { key: 'last_action_date', label: 'Last action' },
  { key: 'identification', label: 'Identification' },
  { key: 'customer_id', label: 'Customer ID' },
] as const;

const DEFAULT_COLUMNS = [
  'cfid',
  'debtor_name',
  'phone',
  'account_no',
  'product',
  'product_code',
  'collector_name',
  'balance',
  'amount_paid',
  'status',
  'last_action_date',
];

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

function buildPageUrl(params: {
  search?: string;
  collector?: string;
  status?: string;
  minBalance?: string;
  maxBalance?: string;
  lastActionFrom?: string;
  lastActionTo?: string;
  limit?: string;
  page?: number;
  columns?: string;
  filter?: string;
}) {
  const query = new URLSearchParams();

  if (params.search) query.set('search', params.search);
  if (params.collector) query.set('collector', params.collector);
  if (params.status) query.set('status', params.status);
  if (params.minBalance) query.set('minBalance', params.minBalance);
  if (params.maxBalance) query.set('maxBalance', params.maxBalance);
  if (params.lastActionFrom) query.set('lastActionFrom', params.lastActionFrom);
  if (params.lastActionTo) query.set('lastActionTo', params.lastActionTo);
  if (params.limit) query.set('limit', params.limit);
  if (params.columns) query.set('columns', params.columns);
  if (params.filter) query.set('filter', params.filter);
  query.set('page', String(params.page || 1));

  return `/accounts?${query.toString()}`;
}

function buildExportUrl(params: {
  search?: string;
  collector?: string;
  status?: string;
  minBalance?: string;
  maxBalance?: string;
  lastActionFrom?: string;
  lastActionTo?: string;
  columns?: string;
  filter?: string;
}) {
  const query = new URLSearchParams();

  if (params.search) query.set('search', params.search);
  if (params.collector) query.set('collector', params.collector);
  if (params.status) query.set('status', params.status);
  if (params.minBalance) query.set('minBalance', params.minBalance);
  if (params.maxBalance) query.set('maxBalance', params.maxBalance);
  if (params.lastActionFrom) query.set('lastActionFrom', params.lastActionFrom);
  if (params.lastActionTo) query.set('lastActionTo', params.lastActionTo);
  if (params.columns) query.set('columns', params.columns);
  if (params.filter) query.set('filter', params.filter);

  return `/api/accounts/export?${query.toString()}`;
}

export default async function AccountsPage({ searchParams }: AccountsPageProps) {
  const resolved = searchParams ? await searchParams : {};

  const search = typeof resolved?.search === 'string' ? resolved.search.trim() : '';
  const collector = typeof resolved?.collector === 'string' ? resolved.collector.trim() : '';
  const status = typeof resolved?.status === 'string' ? resolved.status.trim() : '';
  const minBalance = typeof resolved?.minBalance === 'string' ? resolved.minBalance.trim() : '';
  const maxBalance = typeof resolved?.maxBalance === 'string' ? resolved.maxBalance.trim() : '';
  const lastActionFrom =
    typeof resolved?.lastActionFrom === 'string' ? resolved.lastActionFrom.trim() : '';
  const lastActionTo =
    typeof resolved?.lastActionTo === 'string' ? resolved.lastActionTo.trim() : '';
  const limitParam = typeof resolved?.limit === 'string' ? resolved.limit.trim() : '15';
  const filter = typeof resolved?.filter === 'string' ? resolved.filter.trim() : '';

  const rawColumns = Array.isArray(resolved?.columns)
    ? resolved.columns
    : typeof resolved?.columns === 'string' && resolved.columns.trim() !== ''
    ? [resolved.columns]
    : [];

  const columnsParam =
    rawColumns.length > 0 ? rawColumns.join(',') : DEFAULT_COLUMNS.join(',');

  const pageParam =
    typeof resolved?.page === 'string' ? Number(resolved.page) : 1;

  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const allowedLimits = ['15', '30', '50', 'all'];
  const normalizedLimit = allowedLimits.includes(limitParam) ? limitParam : '15';
  const pageSize = normalizedLimit === 'all' ? null : Number(normalizedLimit);

  const selectedColumns = columnsParam
    .split(',')
    .map((item) => item.trim())
    .filter((item) => AVAILABLE_COLUMNS.some((col) => col.key === item));

  const finalColumns = selectedColumns.length > 0 ? selectedColumns : DEFAULT_COLUMNS;

  const collectorQuery = await supabase
    ?.from('accounts')
    .select('collector_name')
    .eq('company_id', COMPANY_ID)
    .not('collector_name', 'is', null);

  const collectorOptions = Array.from(
    new Set((collectorQuery?.data ?? []).map((row) => row.collector_name).filter(Boolean))
  ).sort();

  let matchedAccountIds: string[] | null = null;

  if (supabase && (filter === 'open-ptps' || filter === 'ptps-due-today')) {
    const { data: ptpRows, error: ptpError } = await supabase
      .from('ptps')
      .select('*')
      .eq('company_id', COMPANY_ID);

    if (ptpError) {
      return (
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold">Accounts</h1>
          <p className="text-red-600">Failed to load PTP filter data: {ptpError.message}</p>
        </div>
      );
    }

    const filteredPtps = (ptpRows ?? []).filter((ptp) => {
      const isOpenPtp = ptp.status === 'Promise To Pay';

      if (filter === 'open-ptps') {
        return isOpenPtp;
      }

      if (filter === 'ptps-due-today') {
        return isOpenPtp && isToday(ptp.promised_date);
      }

      return true;
    });

    matchedAccountIds = Array.from(
      new Set(
        filteredPtps
          .map((ptp) => ptp.account_id)
          .filter((value): value is string => Boolean(value))
      )
    );
  }

  let query = supabase
    ?.from('accounts')
    .select('*', { count: 'exact' })
    .eq('company_id', COMPANY_ID)
    .order('created_at', { ascending: false });

  if (query && matchedAccountIds) {
    query =
      matchedAccountIds.length > 0
        ? query.in('id', matchedAccountIds)
        : query.eq('id', EMPTY_UUID);
  }

  if (query && search) {
    const safeSearch = search.replace(/,/g, '');
    query = query.or(
      [
        `debtor_name.ilike.%${safeSearch}%`,
        `product.ilike.%${safeSearch}%`,
        `product_code.ilike.%${safeSearch}%`,
        `contacts.ilike.%${safeSearch}%`,
        `primary_phone.ilike.%${safeSearch}%`,
        `secondary_phone.ilike.%${safeSearch}%`,
        `tertiary_phone.ilike.%${safeSearch}%`,
        `account_no.ilike.%${safeSearch}%`,
        `identification.ilike.%${safeSearch}%`,
        `customer_id.ilike.%${safeSearch}%`,
      ].join(',')
    );
  }

  if (query && collector) query = query.eq('collector_name', collector);
  if (query && status) query = query.eq('status', status);
  if (query && minBalance) query = query.gte('balance', Number(minBalance));
  if (query && maxBalance) query = query.lte('balance', Number(maxBalance));
  if (query && lastActionFrom) query = query.gte('last_action_date', lastActionFrom);
  if (query && lastActionTo) query = query.lte('last_action_date', lastActionTo);

  if (query && pageSize) {
    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);
  }

  const { data: rows, error, count } = query
    ? await query
    : { data: [], error: new Error('Supabase is not configured'), count: 0 };

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Accounts</h1>
        <p className="text-red-600">Failed to load accounts: {error.message}</p>
      </div>
    );
  }

  const totalAccounts = count ?? rows?.length ?? 0;
  const totalBalance = (rows ?? []).reduce((sum, row) => sum + Number(row.balance || 0), 0);
  const totalPaid = (rows ?? []).reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);
  const openCases = (rows ?? []).filter((row) => row.status !== 'Paid').length;
  const totalPages = pageSize && totalAccounts > 0 ? Math.ceil(totalAccounts / pageSize) : 1;

  const headers = finalColumns.map(
    (key) => AVAILABLE_COLUMNS.find((col) => col.key === key)?.label || key
  );

  const filterLabel =
    filter === 'open-ptps'
      ? 'Open PTP Accounts'
      : filter === 'ptps-due-today'
      ? 'PTPs Due Today'
      : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Portfolio</h1>
          <p className="mt-1 text-slate-500">
            Search, review and work assigned debtor accounts from one operational workspace.
          </p>
          {filterLabel ? (
            <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              Filter: {filterLabel}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href="/accounts-import-template.csv"
            download
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download Template
          </a>

          <a
            href={buildExportUrl({
              search,
              collector,
              status,
              minBalance,
              maxBalance,
              lastActionFrom,
              lastActionTo,
              columns: finalColumns.join(','),
              filter,
            })}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export Excel
          </a>

          <Link
            href="/accounts/product-upload"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Product Upload
          </Link>

          <Link
            href="/accounts/upload"
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
          >
            Upload CSV
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form className="space-y-4">
          <input type="hidden" name="filter" value={filter} />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              type="text"
              name="search"
              defaultValue={search}
              placeholder="Search debtor, product, category, phone, account, ID..."
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />

            <select
              name="collector"
              defaultValue={collector}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All Collectors</option>
              {collectorOptions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>

            <select
              name="status"
              defaultValue={status}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">All Statuses</option>
              <option value="Open">Open</option>
              <option value="PTP">PTP</option>
              <option value="Paid">Paid</option>
              <option value="Escalated">Escalated</option>
              <option value="Promise To Pay">Promise To Pay</option>
            </select>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                name="minBalance"
                defaultValue={minBalance}
                placeholder="Min balance"
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
              <input
                type="number"
                name="maxBalance"
                defaultValue={maxBalance}
                placeholder="Max balance"
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input
              type="date"
              name="lastActionFrom"
              defaultValue={lastActionFrom}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            <input
              type="date"
              name="lastActionTo"
              defaultValue={lastActionTo}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />

            <input type="hidden" name="limit" value={normalizedLimit} />
            <input type="hidden" name="page" value="1" />

            <div className="xl:col-span-2 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Apply Filters
              </button>

              <Link
                href="/accounts"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset
              </Link>
            </div>
          </div>

          <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Choose visible columns
            </summary>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {AVAILABLE_COLUMNS.map((column) => (
                <label key={column.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="columns"
                    value={column.key}
                    defaultChecked={finalColumns.includes(column.key)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          </details>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Accounts Found</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{totalAccounts}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Visible Balance</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{currency(totalBalance)}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Visible Amount Paid</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{currency(totalPaid)}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Visible Open Cases</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{openCases}</p>
        </div>
      </div>

      <DataTable headers={headers}>
        {(rows ?? []).map((row) => (
          <tr key={row.id}>
            {finalColumns.includes('cfid') ? <td className="px-4 py-3 font-medium">{row.cfid || '-'}</td> : null}
            {finalColumns.includes('debtor_name') ? (
              <td className="px-4 py-3">
                <Link href={`/accounts/${row.id}`} className="hover:text-slate-900 hover:underline">
                  {row.debtor_name}
                </Link>
              </td>
            ) : null}
            {finalColumns.includes('phone') ? <td className="px-4 py-3">{row.primary_phone || row.contacts || '-'}</td> : null}
            {finalColumns.includes('account_no') ? <td className="px-4 py-3">{row.account_no || '-'}</td> : null}
            {finalColumns.includes('product') ? <td className="px-4 py-3">{row.product || '-'}</td> : null}
            {finalColumns.includes('product_code') ? <td className="px-4 py-3">{row.product_code || '-'}</td> : null}
            {finalColumns.includes('collector_name') ? <td className="px-4 py-3">{row.collector_name || '-'}</td> : null}
            {finalColumns.includes('balance') ? <td className="px-4 py-3">{currency(Number(row.balance || 0))}</td> : null}
            {finalColumns.includes('amount_paid') ? <td className="px-4 py-3">{currency(Number(row.amount_paid || 0))}</td> : null}
            {finalColumns.includes('status') ? <td className="px-4 py-3">{row.status || '-'}</td> : null}
            {finalColumns.includes('last_action_date') ? <td className="px-4 py-3">{formatDate(row.last_action_date)}</td> : null}
            {finalColumns.includes('identification') ? <td className="px-4 py-3">{row.identification || '-'}</td> : null}
            {finalColumns.includes('customer_id') ? <td className="px-4 py-3">{row.customer_id || '-'}</td> : null}
          </tr>
        ))}
      </DataTable>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form>
          <input type="hidden" name="search" value={search} />
          <input type="hidden" name="collector" value={collector} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="minBalance" value={minBalance} />
          <input type="hidden" name="maxBalance" value={maxBalance} />
          <input type="hidden" name="lastActionFrom" value={lastActionFrom} />
          <input type="hidden" name="lastActionTo" value={lastActionTo} />
          <input type="hidden" name="columns" value={finalColumns.join(',')} />
          <input type="hidden" name="filter" value={filter} />
          <input type="hidden" name="page" value="1" />

          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600">Accounts to view</label>
            <select
              name="limit"
              defaultValue={normalizedLimit}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="15">15</option>
              <option value="30">30</option>
              <option value="50">50</option>
              <option value="all">All</option>
            </select>

            <button
              type="submit"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Update View
            </button>
          </div>
        </form>

        {normalizedLimit !== 'all' && totalPages > 1 ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href={buildPageUrl({
                search,
                collector,
                status,
                minBalance,
                maxBalance,
                lastActionFrom,
                lastActionTo,
                limit: normalizedLimit,
                columns: finalColumns.join(','),
                filter,
                page: Math.max(1, currentPage - 1),
              })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                currentPage === 1
                  ? 'pointer-events-none border-slate-200 text-slate-300'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Previous
            </Link>

            <Link
              href={buildPageUrl({
                search,
                collector,
                status,
                minBalance,
                maxBalance,
                lastActionFrom,
                lastActionTo,
                limit: normalizedLimit,
                columns: finalColumns.join(','),
                filter,
                page: Math.min(totalPages, currentPage + 1),
              })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                currentPage === totalPages
                  ? 'pointer-events-none border-slate-200 text-slate-300'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Next
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {normalizedLimit === 'all' ? 'Showing all accounts' : `Page ${currentPage} of ${totalPages}`}
          </p>
        )}
      </div>

      {search && totalAccounts === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          No accounts found for <span className="font-medium">{search}</span>.
        </div>
      ) : null}
    </div>
  );
}