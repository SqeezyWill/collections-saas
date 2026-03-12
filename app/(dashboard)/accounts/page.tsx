'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

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

type UserProfile = {
  id: string;
  role: string | null;
  company_id: string | null;
};

type AccountRow = {
  id: string;
  cfid: string | null;
  debtor_name: string | null;
  primary_phone: string | null;
  secondary_phone?: string | null;
  tertiary_phone?: string | null;
  contacts: string | null;
  account_no: string | null;
  product: string | null;
  product_code: string | null;
  collector_name: string | null;
  balance: number | null;
  amount_paid: number | null;
  status: string | null;
  last_action_date: string | null;
  identification: string | null;
  customer_id: string | null;
};

type SearchField =
  | 'cfid'
  | 'phone'
  | 'account_no'
  | 'debtor_name'
  | 'identification'
  | 'customer_id';

const ALLOWED_SEARCH_FIELDS: SearchField[] = [
  'cfid',
  'phone',
  'account_no',
  'debtor_name',
  'identification',
  'customer_id',
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

function buildSearchClause(searchField: SearchField, safeSearch: string) {
  switch (searchField) {
    case 'cfid':
      return `cfid.ilike.%${safeSearch}%`;
    case 'phone':
      return [
        `primary_phone.ilike.%${safeSearch}%`,
        `secondary_phone.ilike.%${safeSearch}%`,
        `tertiary_phone.ilike.%${safeSearch}%`,
        `contacts.ilike.%${safeSearch}%`,
      ].join(',');
    case 'account_no':
      return `account_no.ilike.%${safeSearch}%`;
    case 'debtor_name':
      return `debtor_name.ilike.%${safeSearch}%`;
    case 'identification':
      return `identification.ilike.%${safeSearch}%`;
    case 'customer_id':
      return `customer_id.ilike.%${safeSearch}%`;
    default:
      return `cfid.ilike.%${safeSearch}%`;
  }
}

function buildPageUrl(params: {
  search?: string;
  searchField?: string;
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
  if (params.searchField) query.set('searchField', params.searchField);
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
  searchField?: string;
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
  if (params.searchField) query.set('searchField', params.searchField);
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

export default function AccountsPage() {
  const searchParams = useSearchParams();

  const search = searchParams.get('search')?.trim() || '';
  const rawSearchField = searchParams.get('searchField')?.trim() || 'cfid';
  const searchField: SearchField = ALLOWED_SEARCH_FIELDS.includes(rawSearchField as SearchField)
    ? (rawSearchField as SearchField)
    : 'cfid';

  const collector = searchParams.get('collector')?.trim() || '';
  const status = searchParams.get('status')?.trim() || '';
  const minBalance = searchParams.get('minBalance')?.trim() || '';
  const maxBalance = searchParams.get('maxBalance')?.trim() || '';
  const lastActionFrom = searchParams.get('lastActionFrom')?.trim() || '';
  const lastActionTo = searchParams.get('lastActionTo')?.trim() || '';
  const limitParam = searchParams.get('limit')?.trim() || '15';
  const filter = searchParams.get('filter')?.trim() || '';
  const pageParam = Number(searchParams.get('page') || '1');

  const rawColumns = searchParams.getAll('columns');
  const columnsParam =
    rawColumns.length > 0 ? rawColumns.join(',') : DEFAULT_COLUMNS.join(',');

  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const allowedLimits = ['15', '30', '50', 'all'];
  const normalizedLimit = allowedLimits.includes(limitParam) ? limitParam : '15';
  const showingAll = normalizedLimit === 'all';
  const pageSize = showingAll ? 500 : Number(normalizedLimit);
  const effectivePage = showingAll ? 1 : currentPage;

  const selectedColumns = columnsParam
    .split(',')
    .map((item) => item.trim())
    .filter((item) => AVAILABLE_COLUMNS.some((col) => col.key === item));

  const finalColumns = selectedColumns.length > 0 ? selectedColumns : DEFAULT_COLUMNS;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<AccountRow[]>([]);
  const [totalAccounts, setTotalAccounts] = useState(0);
  const [collectorOptions, setCollectorOptions] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadPage() {
      try {
        setLoading(true);
        setErrorMsg(null);

        if (!supabase) {
          throw new Error('Supabase is not configured.');
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        if (!userId) {
          throw new Error('No active session found.');
        }

        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message);
        }

        if (!profileData?.company_id) {
          throw new Error('Your user profile has no company_id.');
        }

        if (!mounted) return;
        setProfile(profileData as UserProfile);

        const companyId = String(profileData.company_id);

        const collectorQuery = await supabase
          .from('accounts')
          .select('collector_name')
          .eq('company_id', companyId)
          .not('collector_name', 'is', null);

        const collectorList = Array.from(
          new Set((collectorQuery.data ?? []).map((row: any) => row.collector_name).filter(Boolean))
        ).sort();

        if (!mounted) return;
        setCollectorOptions(collectorList);

        let matchedAccountIds: string[] | null = null;

        if (filter === 'open-ptps' || filter === 'ptps-due-today') {
          const { data: ptpRows, error: ptpError } = await supabase
            .from('ptps')
            .select('*')
            .eq('company_id', companyId);

          if (ptpError) {
            throw new Error(`Failed to load PTP filter data: ${ptpError.message}`);
          }

          const filteredPtps = (ptpRows ?? []).filter((ptp: any) => {
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
                .map((ptp: any) => ptp.account_id)
                .filter((value: unknown): value is string => Boolean(value))
            )
          );
        }

        let query = supabase
          .from('accounts')
          .select('*', { count: 'exact' })
          .eq('company_id', companyId)
          .order('created_at', { ascending: false });

        if (matchedAccountIds) {
          query =
            matchedAccountIds.length > 0
              ? query.in('id', matchedAccountIds)
              : query.eq('id', EMPTY_UUID);
        }

        if (search) {
          const safeSearch = search.replace(/,/g, '').replace(/[%_]/g, '');
          query = query.or(buildSearchClause(searchField, safeSearch));
        }

        if (collector) query = query.eq('collector_name', collector);
        if (status) query = query.eq('status', status);
        if (minBalance) query = query.gte('balance', Number(minBalance));
        if (maxBalance) query = query.lte('balance', Number(maxBalance));
        if (lastActionFrom) query = query.gte('last_action_date', lastActionFrom);
        if (lastActionTo) query = query.lte('last_action_date', lastActionTo);

        const from = (effectivePage - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;

        if (error) {
          throw new Error(error.message);
        }

        if (!mounted) return;
        setRows((data ?? []) as AccountRow[]);
        setTotalAccounts(count ?? 0);
      } catch (e: any) {
        if (!mounted) return;
        setRows([]);
        setTotalAccounts(0);
        setCollectorOptions([]);
        setErrorMsg(e?.message || 'Failed to load accounts.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadPage();

    return () => {
      mounted = false;
    };
  }, [
    search,
    searchField,
    collector,
    status,
    minBalance,
    maxBalance,
    lastActionFrom,
    lastActionTo,
    normalizedLimit,
    effectivePage,
    filter,
  ]);

  const totalBalance = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.balance || 0), 0),
    [rows]
  );

  const totalPaid = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0),
    [rows]
  );

  const openCases = useMemo(
    () => rows.filter((row) => row.status !== 'Paid').length,
    [rows]
  );

  const totalPages = totalAccounts > 0 ? Math.ceil(totalAccounts / pageSize) : 1;

  const headers = finalColumns.map(
    (key) => AVAILABLE_COLUMNS.find((col) => col.key === key)?.label || key
  );

  const filterLabel =
    filter === 'open-ptps'
      ? 'Open PTP Accounts'
      : filter === 'ptps-due-today'
        ? 'PTPs Due Today'
        : '';

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Portfolio</h1>
        <p className="text-slate-500">Loading accounts…</p>
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Portfolio</h1>
        <p className="text-red-600">{errorMsg}</p>
      </div>
    );
  }

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
              searchField,
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
              placeholder="Search selected field..."
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />

            <select
              name="searchField"
              defaultValue={searchField}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="cfid">CFID</option>
              <option value="phone">PHONE</option>
              <option value="account_no">ACCOUNT NUMBER</option>
              <option value="debtor_name">DEBTOR NAME</option>
              <option value="identification">IDENTIFICATION</option>
              <option value="customer_id">CUSTOMER ID</option>
            </select>

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
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
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

            <div className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="limit" value={normalizedLimit} />
              <input type="hidden" name="page" value="1" />

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
        {rows.map((row) => (
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
            {finalColumns.includes('last_action_date') ? <td className="px-4 py-3">{row.last_action_date ? formatDate(row.last_action_date) : '-'}</td> : null}
            {finalColumns.includes('identification') ? <td className="px-4 py-3">{row.identification || '-'}</td> : null}
            {finalColumns.includes('customer_id') ? <td className="px-4 py-3">{row.customer_id || '-'}</td> : null}
          </tr>
        ))}
      </DataTable>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form>
          <input type="hidden" name="search" value={search} />
          <input type="hidden" name="searchField" value={searchField} />
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
                searchField,
                collector,
                status,
                minBalance,
                maxBalance,
                lastActionFrom,
                lastActionTo,
                limit: normalizedLimit,
                columns: finalColumns.join(','),
                filter,
                page: Math.max(1, effectivePage - 1),
              })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                effectivePage === 1
                  ? 'pointer-events-none border-slate-200 text-slate-300'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Previous
            </Link>

            <Link
              href={buildPageUrl({
                search,
                searchField,
                collector,
                status,
                minBalance,
                maxBalance,
                lastActionFrom,
                lastActionTo,
                limit: normalizedLimit,
                columns: finalColumns.join(','),
                filter,
                page: Math.min(totalPages, effectivePage + 1),
              })}
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${
                effectivePage === totalPages
                  ? 'pointer-events-none border-slate-200 text-slate-300'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Next
            </Link>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {showingAll ? `Showing first ${rows.length} accounts` : `Page ${effectivePage} of ${totalPages}`}
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