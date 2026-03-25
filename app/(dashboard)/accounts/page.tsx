'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

const EMPTY_UUID = '00000000-0000-0000-0000-000000000000';
const PORTFOLIO_CACHE_PREFIX = 'portfolio-cache:v1:';
const PORTFOLIO_SCROLL_PREFIX = 'portfolio-scroll:v1:';

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

const SAVED_VIEWS = [
  {
    key: 'all',
    label: 'All Accounts',
    helper: 'Full operational portfolio',
    buildHref: () => '/accounts',
  },
  {
    key: 'open_ptps',
    label: 'Open PTP Accounts',
    helper: 'Accounts with active promises',
    buildHref: () => '/accounts?filter=open-ptps',
  },
  {
    key: 'ptps_today',
    label: 'PTPs Due Today',
    helper: 'Promises due today',
    buildHref: () => '/accounts?filter=ptps-due-today',
  },
  {
    key: 'broken_ptps',
    label: 'Broken PTP Follow-up',
    helper: 'Accounts linked to broken promises',
    buildHref: () => '/accounts?filter=broken-ptps',
  },
  {
    key: 'callbacks_today',
    label: 'Callbacks Due Today',
    helper: 'Callback actions due today',
    buildHref: () => '/accounts?filter=callbacks-due-today',
  },
  {
    key: 'overdue_callbacks',
    label: 'Overdue Callbacks',
    helper: 'Missed callback actions needing follow-up',
    buildHref: () => '/accounts?filter=overdue-callbacks',
  },
  {
    key: 'next_actions_today',
    label: 'Next Actions Due Today',
    helper: 'Accounts with next action due today',
    buildHref: () => '/accounts?filter=next-actions-today',
  },
  {
    key: 'stale_accounts',
    label: 'Stale Accounts',
    helper: 'No action in 3+ days or no action date',
    buildHref: () => '/accounts?filter=stale-accounts',
  },
  {
    key: 'paid',
    label: 'Paid Accounts',
    helper: 'Accounts marked paid',
    buildHref: () => '/accounts?status=Paid',
  },
  {
    key: 'escalated',
    label: 'Escalated Accounts',
    helper: 'Accounts needing management attention',
    buildHref: () => '/accounts?status=Escalated',
  },
] as const;

type UserProfile = {
  id: string;
  name?: string | null;
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
  next_action_date?: string | null;
  identification: string | null;
  customer_id: string | null;
};

type AdminUserRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  companyId: string | null;
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

function toDateOnly(value: string | null | undefined) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function todayDateString() {
  return toDateOnly(new Date().toISOString());
}

function daysAgoDateString(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toDateOnly(d.toISOString());
}

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || '').trim();
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
  const currentQueryString = searchParams.toString();
  const portfolioCacheKey = `${PORTFOLIO_CACHE_PREFIX}${currentQueryString}`;
  const portfolioScrollKey = `${PORTFOLIO_SCROLL_PREFIX}${currentQueryString}`;

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
  const [agentOptions, setAgentOptions] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkAssignCollector, setBulkAssignCollector] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [bulkFilteredActionLoading, setBulkFilteredActionLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [resolvedCompanyId, setResolvedCompanyId] = useState('');
  const [companyResolved, setCompanyResolved] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);

  const normalizedProfileRole = normalizeRole(profile?.role);
  const isAgent = normalizedProfileRole === 'agent';
  const canManageUploads =
    normalizedProfileRole === 'super_admin' || normalizedProfileRole === 'admin';
  const canUseBulkActions =
    normalizedProfileRole === 'super_admin' || normalizedProfileRole === 'admin';

  async function authHeaders(includeJson = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};

    if (includeJson) {
      headers['Content-Type'] = 'application/json';
    }

    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    return headers;
  }

  async function readJsonSafe(res: Response) {
    const text = await res.text();
    if (!text) return { json: null as any, text: '' };

    try {
      return { json: JSON.parse(text), text };
    } catch {
      return { json: null as any, text };
    }
  }

  async function collectFilteredAccountIds(input: {
    companyId: string;
    restrictToCollector?: string;
  }) {
    if (!supabase) return [];

    const { companyId, restrictToCollector } = input;
    const PAGE_FETCH_SIZE = 1000;
    const collectedIds: string[] = [];
    const today = todayDateString();
    const staleThreshold = daysAgoDateString(3);

    let matchedAccountIds: string[] | null = null;

    if (
      filter === 'open-ptps' ||
      filter === 'ptps-due-today' ||
      filter === 'broken-ptps'
    ) {
      let ptpQuery = supabase
        .from('ptps')
        .select('account_id,status,promised_date')
        .eq('company_id', companyId);

      if (restrictToCollector) {
        ptpQuery = ptpQuery.eq('collector_name', restrictToCollector);
      }

      if (filter === 'open-ptps') {
        ptpQuery = ptpQuery.eq('status', 'Promise To Pay');
      }

      if (filter === 'ptps-due-today') {
        ptpQuery = ptpQuery.eq('status', 'Promise To Pay').eq('promised_date', today);
      }

      const { data: ptpRows, error: ptpError } = await ptpQuery;

      if (ptpError) {
        throw new Error(`Failed to load PTP filter data: ${ptpError.message}`);
      }

      const filteredPtps =
        filter === 'broken-ptps'
          ? (ptpRows ?? []).filter(
              (ptp: any) =>
                ptp.status === 'Broken' ||
                (ptp.status === 'Promise To Pay' &&
                  ptp.promised_date &&
                  toDateOnly(ptp.promised_date) < today)
            )
          : ptpRows ?? [];

      matchedAccountIds = Array.from(
        new Set(
          filteredPtps
            .map((ptp: any) => ptp.account_id)
            .filter((value: unknown): value is string => Boolean(value))
        )
      );
    }

    let from = 0;

    while (true) {
      let query = supabase
        .from('accounts')
        .select('id')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (restrictToCollector) {
        query = query.eq('collector_name', restrictToCollector);
      }

      if (matchedAccountIds) {
        query =
          matchedAccountIds.length > 0
            ? query.in('id', matchedAccountIds)
            : query.eq('id', EMPTY_UUID);
      }

      if (filter === 'callbacks-due-today') {
        query = query.eq('status', 'Callback Requested').eq('next_action_date', today);
      }

      if (filter === 'overdue-callbacks') {
        query = query.eq('status', 'Callback Requested').lt('next_action_date', today);
      }

      if (filter === 'next-actions-today') {
        query = query.eq('next_action_date', today);
      }

      if (filter === 'stale-accounts') {
        query = query.or(`last_action_date.is.null,last_action_date.lte.${staleThreshold}`);
      }

      if (search) {
        const safeSearch = search.replace(/,/g, '').replace(/[%_]/g, '');
        query = query.or(buildSearchClause(searchField, safeSearch));
      }

      if (collector && !restrictToCollector) query = query.eq('collector_name', collector);
      if (status) query = query.eq('status', status);
      if (minBalance) query = query.gte('balance', Number(minBalance));
      if (maxBalance) query = query.lte('balance', Number(maxBalance));
      if (lastActionFrom) query = query.gte('last_action_date', lastActionFrom);
      if (lastActionTo) query = query.lte('last_action_date', lastActionTo);

      const { data, error } = await query.range(from, from + PAGE_FETCH_SIZE - 1);

      if (error) {
        throw new Error(error.message);
      }

      const batch = data ?? [];
      collectedIds.push(...batch.map((row: any) => String(row.id)).filter(Boolean));

      if (batch.length < PAGE_FETCH_SIZE) {
        break;
      }

      from += PAGE_FETCH_SIZE;
    }

    return collectedIds;
  }

  async function handleBulkFilteredReassign() {
    if (!supabase) {
      setBulkMessage('Supabase is not configured.');
      return;
    }

    if (!canUseBulkActions) {
      setBulkMessage('You do not have permission to use bulk actions.');
      return;
    }

    if (!profile?.company_id) {
      setBulkMessage('Unable to resolve company context.');
      return;
    }

    if (!bulkAssignCollector.trim()) {
      setBulkMessage('Please choose an agent first.');
      return;
    }

    setBulkFilteredActionLoading(true);
    setBulkMessage(null);

    try {
      const restrictToCollector = isAgent ? String(profile?.name || '').trim() : '';
      const allMatchingIds = await collectFilteredAccountIds({
        companyId: profile.company_id,
        restrictToCollector,
      });

      if (allMatchingIds.length === 0) {
        setBulkMessage('No accounts match the current filters.');
        return;
      }

      const selectedAgentName = bulkAssignCollector.trim();
      const assignDate = todayDateString();
      const UPDATE_CHUNK = 500;

      for (let i = 0; i < allMatchingIds.length; i += UPDATE_CHUNK) {
        const chunk = allMatchingIds.slice(i, i + UPDATE_CHUNK);

        const { error: assignError } = await supabase
          .from('accounts')
          .update({
            collector_name: selectedAgentName,
            last_action_date: assignDate,
          })
          .in('id', chunk);

        if (assignError) {
          throw new Error(assignError.message);
        }

        const noteRows = chunk.map((accountId) => ({
          company_id: profile.company_id,
          account_id: accountId,
          created_by_name: profile.name || 'System User',
          body: `Bulk action: Account reassigned to ${selectedAgentName} using filtered bulk reallocation.`,
        }));

        const { error: notesError } = await supabase.from('notes').insert(noteRows);
        if (notesError) {
          throw new Error(notesError.message);
        }
      }

      setBulkMessage(
        `Reassigned ${allMatchingIds.length} filtered account(s) to ${selectedAgentName}.`
      );
      setSelectedIds([]);
      setBulkAssignCollector('');
      setReloadKey((prev) => prev + 1);
    } catch (error: any) {
      setBulkMessage(error?.message || 'Failed to reassign filtered accounts.');
    } finally {
      setBulkFilteredActionLoading(false);
    }
  }

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(portfolioCacheKey);

      if (!raw) {
        setCacheHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed?.rows)) setRows(parsed.rows);
      if (typeof parsed?.totalAccounts === 'number') setTotalAccounts(parsed.totalAccounts);
      if (Array.isArray(parsed?.collectorOptions)) setCollectorOptions(parsed.collectorOptions);
      if (Array.isArray(parsed?.agentOptions)) setAgentOptions(parsed.agentOptions);
      if (parsed?.profile) setProfile(parsed.profile);

      if (typeof parsed?.resolvedCompanyId === 'string' && parsed.resolvedCompanyId.trim()) {
        setResolvedCompanyId(parsed.resolvedCompanyId);
        setCompanyResolved(true);
      }

      setLoading(false);
    } catch {
      // ignore cache errors
    } finally {
      setCacheHydrated(true);
    }
  }, [portfolioCacheKey]);

  useEffect(() => {
    let mounted = true;

    async function loadCompanyContext() {
      try {
        if (!supabase) return;

        const {
          data: { session },
        } = await supabase.auth.getSession();

        const userId = session?.user?.id;
        if (!userId) {
          if (mounted) {
            setErrorMsg('No active session found.');
            setCompanyResolved(true);
          }
          return;
        }

        const { data: profileData } = await supabase
          .from('user_profiles')
          .select('company_id')
          .eq('id', userId)
          .maybeSingle();

        let companyId = String(profileData?.company_id || '').trim();

        if (!companyId) {
          const { data: fixedCompany, error: fixedCompanyError } = await supabase
            .from('companies')
            .select('id,name,code')
            .or('name.eq.Pezesha,code.eq.Pezesha')
            .limit(1)
            .maybeSingle();

          if (fixedCompanyError || !fixedCompany?.id) {
            throw new Error('Unable to resolve fixed Pezesha company.');
          }

          companyId = String(fixedCompany.id);
        }

        if (mounted) {
          setResolvedCompanyId(companyId);
          setCompanyResolved(true);
        }
      } catch (error: any) {
        if (mounted) {
          setErrorMsg(error?.message || 'Unable to resolve company context.');
          setCompanyResolved(true);
        }
      }
    }

    loadCompanyContext();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadPage() {
      try {
        if (rows.length === 0) {
          setLoading(true);
        } else {
          setIsRefreshing(true);
        }
        setErrorMsg(null);

        if (!supabase) {
          throw new Error('Supabase is not configured.');
        }

        if (!cacheHydrated || !companyResolved) {
          return;
        }

        if (!resolvedCompanyId) {
          throw new Error('Unable to resolve company context.');
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const userId = sessionData.session?.user?.id;

        if (!userId) {
          throw new Error('No active session found.');
        }

        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id,name,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (profileError) {
          throw new Error(profileError.message);
        }

        setProfile({
          ...(profileData as UserProfile),
          company_id: resolvedCompanyId,
        });

        const companyId = resolvedCompanyId;
        const profileName = String(profileData?.name || '').trim();
        const profileRole = normalizeRole(profileData?.role);
        const restrictToCollector = profileRole === 'agent' ? profileName : '';

        const today = todayDateString();
        const staleThreshold = daysAgoDateString(3);

        let collectorQuery = supabase
          .from('accounts')
          .select('collector_name')
          .eq('company_id', companyId)
          .not('collector_name', 'is', null)
          .limit(300);

        if (restrictToCollector) {
          collectorQuery = collectorQuery.eq('collector_name', restrictToCollector);
        }

        const collectorResult = await collectorQuery;

        const collectorList = Array.from(
          new Set(
            (collectorResult.data ?? [])
              .map((row: any) => row.collector_name)
              .filter(Boolean)
          )
        ).sort();

        const usersRes = await fetch('/api/admin/users', {
          headers: await authHeaders(),
          cache: 'no-store',
        });

        const { json: usersJson, text: usersText } = await readJsonSafe(usersRes);

        if (!usersRes.ok) {
          const msg =
            usersJson?.error ||
            (usersText ? usersText.slice(0, 180) : 'Failed to load users for reassignment.');
          throw new Error(msg);
        }

        const agentList = Array.from(
          new Set(
            ((usersJson?.users ?? []) as AdminUserRow[])
              .filter((user) => normalizeRole(user.role) === 'agent')
              .map((user) => normalizeName(user.name))
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));

        if (!mounted) return;
        setCollectorOptions(collectorList);
        setAgentOptions(agentList);

        let matchedAccountIds: string[] | null = null;

        if (
          filter === 'open-ptps' ||
          filter === 'ptps-due-today' ||
          filter === 'broken-ptps'
        ) {
          let ptpQuery = supabase
            .from('ptps')
            .select('account_id,status,promised_date')
            .eq('company_id', companyId);

          if (restrictToCollector) {
            ptpQuery = ptpQuery.eq('collector_name', restrictToCollector);
          }

          if (filter === 'open-ptps') {
            ptpQuery = ptpQuery.eq('status', 'Promise To Pay');
          }

          if (filter === 'ptps-due-today') {
            ptpQuery = ptpQuery.eq('status', 'Promise To Pay').eq('promised_date', today);
          }

          const { data: ptpRows, error: ptpError } = await ptpQuery;

          if (ptpError) {
            throw new Error(`Failed to load PTP filter data: ${ptpError.message}`);
          }

          const filteredPtps =
            filter === 'broken-ptps'
              ? (ptpRows ?? []).filter(
                  (ptp: any) =>
                    ptp.status === 'Broken' ||
                    (ptp.status === 'Promise To Pay' &&
                      ptp.promised_date &&
                      toDateOnly(ptp.promised_date) < today)
                )
              : ptpRows ?? [];

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

        if (restrictToCollector) {
          query = query.eq('collector_name', restrictToCollector);
        }

        if (matchedAccountIds) {
          query =
            matchedAccountIds.length > 0
              ? query.in('id', matchedAccountIds)
              : query.eq('id', EMPTY_UUID);
        }

        if (filter === 'callbacks-due-today') {
          query = query.eq('status', 'Callback Requested').eq('next_action_date', today);
        }

        if (filter === 'overdue-callbacks') {
          query = query.eq('status', 'Callback Requested').lt('next_action_date', today);
        }

        if (filter === 'next-actions-today') {
          query = query.eq('next_action_date', today);
        }

        if (filter === 'stale-accounts') {
          query = query.or(`last_action_date.is.null,last_action_date.lte.${staleThreshold}`);
        }

        if (search) {
          const safeSearch = search.replace(/,/g, '').replace(/[%_]/g, '');
          query = query.or(buildSearchClause(searchField, safeSearch));
        }

        if (collector && !restrictToCollector) query = query.eq('collector_name', collector);
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
        setErrorMsg(e?.message || 'Failed to load accounts.');
      } finally {
        if (mounted) {
          setLoading(false);
          setIsRefreshing(false);
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
    filter,
    effectivePage,
    pageSize,
    reloadKey,
    companyResolved,
    resolvedCompanyId,
    cacheHydrated,
  ]);

  useEffect(() => {
    if (!cacheHydrated) return;

    try {
      sessionStorage.setItem(
        portfolioCacheKey,
        JSON.stringify({
          rows,
          totalAccounts,
          collectorOptions,
          agentOptions,
          profile,
          resolvedCompanyId,
          savedAt: Date.now(),
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [
    portfolioCacheKey,
    rows,
    totalAccounts,
    collectorOptions,
    agentOptions,
    profile,
    resolvedCompanyId,
    cacheHydrated,
  ]);

  useEffect(() => {
    function saveScroll() {
      try {
        sessionStorage.setItem(portfolioScrollKey, String(window.scrollY));
      } catch {
        // ignore
      }
    }

    window.addEventListener('scroll', saveScroll, { passive: true });
    return () => window.removeEventListener('scroll', saveScroll);
  }, [portfolioScrollKey]);

  useEffect(() => {
    if (!cacheHydrated) return;

    try {
      const savedScroll = sessionStorage.getItem(portfolioScrollKey);
      if (!savedScroll) return;

      requestAnimationFrame(() => {
        window.scrollTo(0, Number(savedScroll || '0'));
      });
    } catch {
      // ignore
    }
  }, [portfolioScrollKey, cacheHydrated]);

  useEffect(() => {
    setSelectedIds([]);
    setBulkMessage(null);
    setBulkAssignCollector('');
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

  const headers = [
    ...(canUseBulkActions ? ['Select'] : []),
    ...finalColumns.map(
      (key) => AVAILABLE_COLUMNS.find((col) => col.key === key)?.label || key
    ),
  ];

  const filterLabel =
    filter === 'open-ptps'
      ? 'Open PTP Accounts'
      : filter === 'ptps-due-today'
      ? 'PTPs Due Today'
      : filter === 'broken-ptps'
      ? 'Broken PTP Follow-up'
      : filter === 'callbacks-due-today'
      ? 'Callbacks Due Today'
      : filter === 'overdue-callbacks'
      ? 'Overdue Callbacks'
      : filter === 'next-actions-today'
      ? 'Next Actions Due Today'
      : filter === 'stale-accounts'
      ? 'Stale Accounts'
      : '';

  const selectedBalance = useMemo(
    () =>
      rows
        .filter((row) => selectedIds.includes(row.id))
        .reduce((sum, row) => sum + Number(row.balance || 0), 0),
    [rows, selectedIds]
  );

  const currentPageIds = useMemo(() => rows.map((row) => row.id), [rows]);

  const allCurrentPageSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.includes(id));

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((item) => item !== id);
      return [...prev, id];
    });
  }

  function toggleSelectPage() {
    setSelectedIds((prev) => {
      if (allCurrentPageSelected) {
        return prev.filter((id) => !currentPageIds.includes(id));
      }

      return Array.from(new Set([...prev, ...currentPageIds]));
    });
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function handleBulkAction(action: 'export' | 'mark_review' | 'assign') {
    if (!supabase) {
      setBulkMessage('Supabase is not configured.');
      return;
    }

    if (!canUseBulkActions) {
      setBulkMessage('You do not have permission to use bulk actions.');
      return;
    }

    if (selectedIds.length === 0) {
      setBulkMessage('Please select at least one account.');
      return;
    }

    if (action === 'export') {
      const selectedRows = rows.filter((row) => selectedIds.includes(row.id));

      const exportRows = selectedRows.map((row) => ({
        CFID: row.cfid || '',
        Debtor: row.debtor_name || '',
        Phone: row.primary_phone || row.contacts || '',
        Account: row.account_no || '',
        Product: row.product || '',
        ProductCategory: row.product_code || '',
        Collector: row.collector_name || '',
        Balance: Number(row.balance || 0),
        AmountPaid: Number(row.amount_paid || 0),
        Status: row.status || '',
        LastActionDate: row.last_action_date || '',
        Identification: row.identification || '',
        CustomerID: row.customer_id || '',
      }));

      downloadCsv(`selected-accounts-${todayDateString()}.csv`, exportRows);
      setBulkMessage(`Exported ${selectedIds.length} selected account(s).`);
      return;
    }

    if (action === 'mark_review') {
      setActionLoading(true);
      setBulkMessage(null);

      try {
        const reviewDate = todayDateString();

        const { error: updateError } = await supabase
          .from('accounts')
          .update({
            status: 'Escalated',
            last_action_date: reviewDate,
          })
          .in('id', selectedIds);

        if (updateError) {
          throw new Error(updateError.message);
        }

        if (profile?.company_id) {
          const noteRows = selectedIds.map((accountId) => ({
            company_id: profile.company_id,
            account_id: accountId,
            created_by_name: profile.name || 'System User',
            body: 'Bulk action: Account marked for management review and escalated.',
          }));

          const { error: notesError } = await supabase.from('notes').insert(noteRows);
          if (notesError) {
            throw new Error(notesError.message);
          }
        }

        setBulkMessage(`Marked ${selectedIds.length} account(s) for management review.`);
        setSelectedIds([]);
        setReloadKey((prev) => prev + 1);
      } catch (error: any) {
        setBulkMessage(error?.message || 'Failed to mark selected accounts for review.');
      } finally {
        setActionLoading(false);
      }

      return;
    }

    if (action === 'assign') {
      if (!bulkAssignCollector.trim()) {
        setBulkMessage('Please choose an agent first.');
        return;
      }

      setActionLoading(true);
      setBulkMessage(null);

      try {
        const assignDate = todayDateString();
        const selectedAgentName = bulkAssignCollector.trim();

        const { error: assignError } = await supabase
          .from('accounts')
          .update({
            collector_name: selectedAgentName,
            last_action_date: assignDate,
          })
          .in('id', selectedIds);

        if (assignError) {
          throw new Error(assignError.message);
        }

        if (profile?.company_id) {
          const noteRows = selectedIds.map((accountId) => ({
            company_id: profile.company_id,
            account_id: accountId,
            created_by_name: profile.name || 'System User',
            body: `Bulk action: Account reassigned to ${selectedAgentName}.`,
          }));

          const { error: notesError } = await supabase.from('notes').insert(noteRows);
          if (notesError) {
            throw new Error(notesError.message);
          }
        }

        setBulkMessage(
          `Reassigned ${selectedIds.length} account(s) to ${selectedAgentName}.`
        );
        setSelectedIds([]);
        setBulkAssignCollector('');
        setReloadKey((prev) => prev + 1);
      } catch (error: any) {
        setBulkMessage(error?.message || 'Failed to reassign selected accounts.');
      } finally {
        setActionLoading(false);
      }
    }
  }

  function isSavedViewActive(viewKey: string) {
    return (
      (viewKey === 'all' && !filter && !status) ||
      (viewKey === 'open_ptps' && filter === 'open-ptps') ||
      (viewKey === 'ptps_today' && filter === 'ptps-due-today') ||
      (viewKey === 'broken_ptps' && filter === 'broken-ptps') ||
      (viewKey === 'callbacks_today' && filter === 'callbacks-due-today') ||
      (viewKey === 'overdue_callbacks' && filter === 'overdue-callbacks') ||
      (viewKey === 'next_actions_today' && filter === 'next-actions-today') ||
      (viewKey === 'stale_accounts' && filter === 'stale-accounts') ||
      (viewKey === 'paid' && status === 'Paid') ||
      (viewKey === 'escalated' && status === 'Escalated')
    );
  }

  if (loading && rows.length === 0) {
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
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold">Portfolio</h1>
            {isRefreshing ? (
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Refreshing…
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-slate-500">
            Search, review and work assigned debtor accounts from one operational workspace.
          </p>
          {isAgent ? (
            <p className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
              Agent view: only your allocated accounts are visible
            </p>
          ) : null}
          {filterLabel ? (
            <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              Filter: {filterLabel}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href={buildExportUrl({
              search,
              searchField,
              collector: isAgent ? '' : collector,
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

          {canManageUploads ? (
            <>
              <a
                href="/accounts-import-template.csv"
                download
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download Template
              </a>

              <Link
                href="/accounts/product-upload"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Product Upload
              </Link>

              <Link
                href="/accounts/upload"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                New Accounts Upload
              </Link>

              <Link
                href="/accounts/update-upload"
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Accounts Update Upload
              </Link>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Saved Views</h2>
            <p className="mt-1 text-sm text-slate-500">
              Jump quickly into common operational worklists.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {SAVED_VIEWS.map((view) => {
              const href = view.buildHref();
              const isActive = isSavedViewActive(view.key);

              return (
                <Link
                  key={view.key}
                  href={href}
                  className={`rounded-2xl border p-4 transition ${
                    isActive
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-white'
                  }`}
                >
                  <p className="text-sm font-medium">{view.label}</p>
                  <p className={`mt-1 text-xs ${isActive ? 'text-slate-200' : 'text-slate-500'}`}>
                    {view.helper}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>

        {canUseBulkActions ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Bulk Selection</h2>
              <p className="mt-1 text-sm text-slate-500">
                Work on selected accounts faster from the current page.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Selected</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{selectedIds.length}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Selected Balance</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {currency(selectedBalance)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Page Rows</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{rows.length}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={toggleSelectPage}
                disabled={actionLoading || bulkFilteredActionLoading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {allCurrentPageSelected ? 'Unselect Page' : 'Select Page'}
              </button>

              <button
                type="button"
                onClick={clearSelection}
                disabled={actionLoading || bulkFilteredActionLoading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Clear Selection
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction('export')}
                disabled={actionLoading || bulkFilteredActionLoading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Bulk Export
              </button>

              <button
                type="button"
                onClick={() => handleBulkAction('mark_review')}
                disabled={actionLoading || bulkFilteredActionLoading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Mark for Review
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <select
                value={bulkAssignCollector}
                onChange={(e) => setBulkAssignCollector(e.target.value)}
                disabled={actionLoading || bulkFilteredActionLoading}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:opacity-50"
              >
                <option value="">Select agent to reassign</option>
                {agentOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => handleBulkAction('assign')}
                disabled={actionLoading || bulkFilteredActionLoading}
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Reassign Selected'}
              </button>

              <button
                type="button"
                onClick={handleBulkFilteredReassign}
                disabled={actionLoading || bulkFilteredActionLoading}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {bulkFilteredActionLoading
                  ? 'Reallocating Filtered Accounts...'
                  : `Reassign All Filtered (${totalAccounts})`}
              </button>
            </div>

            {bulkMessage ? (
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {bulkMessage}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Portfolio Summary</h2>
              <p className="mt-1 text-sm text-slate-500">
                Your visible portfolio is limited to accounts assigned to you.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Visible Accounts</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{rows.length}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Visible Balance</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {currency(totalBalance)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Open Cases</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{openCases}</p>
              </div>
            </div>
          </div>
        )}
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
              disabled={isAgent}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100"
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
              <option value="Broken">Broken</option>
              <option value="Callback Requested">Callback Requested</option>
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
            {canUseBulkActions ? (
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(row.id)}
                  onChange={() => toggleRow(row.id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
              </td>
            ) : null}

            {finalColumns.includes('cfid') ? (
              <td className="px-4 py-3 font-medium">{row.cfid || '-'}</td>
            ) : null}
            {finalColumns.includes('debtor_name') ? (
              <td className="px-4 py-3">
                <Link href={`/accounts/${row.id}`} className="hover:text-slate-900 hover:underline">
                  {row.debtor_name}
                </Link>
              </td>
            ) : null}
            {finalColumns.includes('phone') ? (
              <td className="px-4 py-3">{row.primary_phone || row.contacts || '-'}</td>
            ) : null}
            {finalColumns.includes('account_no') ? (
              <td className="px-4 py-3">{row.account_no || '-'}</td>
            ) : null}
            {finalColumns.includes('product') ? (
              <td className="px-4 py-3">{row.product || '-'}</td>
            ) : null}
            {finalColumns.includes('product_code') ? (
              <td className="px-4 py-3">{row.product_code || '-'}</td>
            ) : null}
            {finalColumns.includes('collector_name') ? (
              <td className="px-4 py-3">{row.collector_name || '-'}</td>
            ) : null}
            {finalColumns.includes('balance') ? (
              <td className="px-4 py-3">{currency(Number(row.balance || 0))}</td>
            ) : null}
            {finalColumns.includes('amount_paid') ? (
              <td className="px-4 py-3">{currency(Number(row.amount_paid || 0))}</td>
            ) : null}
            {finalColumns.includes('status') ? (
              <td className="px-4 py-3">{row.status || '-'}</td>
            ) : null}
            {finalColumns.includes('last_action_date') ? (
              <td className="px-4 py-3">
                {row.last_action_date ? formatDate(row.last_action_date) : '-'}
              </td>
            ) : null}
            {finalColumns.includes('identification') ? (
              <td className="px-4 py-3">{row.identification || '-'}</td>
            ) : null}
            {finalColumns.includes('customer_id') ? (
              <td className="px-4 py-3">{row.customer_id || '-'}</td>
            ) : null}
          </tr>
        ))}
      </DataTable>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form>
          <input type="hidden" name="search" value={search} />
          <input type="hidden" name="searchField" value={searchField} />
          <input type="hidden" name="collector" value={isAgent ? '' : collector} />
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
                collector: isAgent ? '' : collector,
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
                collector: isAgent ? '' : collector,
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
            {showingAll
              ? `Showing first ${rows.length} accounts`
              : `Page ${effectivePage} of ${totalPages}`}
          </p>
        )}
      </div>

      {!search && totalAccounts === 0 && isAgent ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          No accounts are assigned to you yet.
        </div>
      ) : null}

      {search && totalAccounts === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
          No accounts found for <span className="font-medium">{search}</span>.
        </div>
      ) : null}
    </div>
  );
}