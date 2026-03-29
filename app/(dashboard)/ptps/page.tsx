'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

const TOP_TABLE_LIMIT = 15;
const CACHE_VERSION = 'v2';

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

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

function monthKeyFromDate(value: string | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthLabelFromKey(key: string) {
  const [year, month] = key.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
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

function buildOperationalPtpKey(row: any) {
  const accountId = String(row?.account_id || '').trim();
  const promisedDate = toDateOnly(row?.promised_date);
  if (!accountId || !promisedDate) {
    return String(row?.id || '');
  }
  return `${accountId}::${promisedDate}`;
}

function dedupeOperationalRows(rows: any[]) {
  const byKey = new Map<string, any>();

  for (const row of rows) {
    const key = buildOperationalPtpKey(row);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, row);
      continue;
    }

    const existingTime = new Date(existing.created_at || 0).getTime();
    const currentTime = new Date(row.created_at || 0).getTime();

    if (currentTime >= existingTime) {
      byKey.set(key, row);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const at = new Date(a.created_at || 0).getTime();
    const bt = new Date(b.created_at || 0).getTime();
    return bt - at;
  });
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

type MonthlySummaryRow = {
  monthKey: string;
  monthLabel: string;
  totalBooked: number;
  openPtps: number;
  keptPtps: number;
  brokenPtps: number;
  rebookedPtps: number;
  totalPromisedAmount: number;
  totalKeptAmount: number;
  keptRatePct: number;
};

type AuthProfile = {
  id: string;
  name: string | null;
  role: string | null;
  company_id: string | null;
};

type CachedState = {
  profile: AuthProfile | null;
  rows: any[];
  allRows: any[];
  cachedAt: string;
};

export default function PtpsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [allRows, setAllRows] = useState<any[]>([]);

  useEffect(() => {
    let mounted = true;

    async function loadFilter() {
      const resolved = searchParams ? await searchParams : {};
      const nextFilter = typeof resolved?.filter === 'string' ? resolved.filter.trim() : '';
      if (mounted) {
        setFilter(nextFilter);
      }
    }

    loadFilter();

    return () => {
      mounted = false;
    };
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;

    async function loadPtps() {
      try {
        if (!supabase) {
          if (mounted) {
            setErrorMessage('Supabase is not configured.');
            setLoading(false);
          }
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        const userId = session?.user?.id;
        if (!userId) {
          if (mounted) {
            setErrorMessage('Unable to load user session.');
            setLoading(false);
          }
          return;
        }

        const cacheKey = `ptps_page_cache_${CACHE_VERSION}:${userId}`;

        try {
          const raw = window.sessionStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw) as CachedState;
            if (mounted && parsed?.allRows && parsed?.profile) {
              setProfile(parsed.profile);
              setAllRows(parsed.allRows);
              setRows(parsed.rows || parsed.allRows);
              setLoading(false);
              setRefreshing(true);
            }
          }
        } catch {
          // ignore cache read errors
        }

        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id,name,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (profileError || !profileData?.id) {
          if (mounted) {
            setErrorMessage('Unable to load user profile.');
            setLoading(false);
            setRefreshing(false);
          }
          return;
        }

        let resolvedCompanyId = String(profileData.company_id || '').trim();

        if (!resolvedCompanyId) {
          const { data: fixedCompany, error: fixedCompanyError } = await supabase
            .from('companies')
            .select('id,name,code')
            .or('name.eq.Pezesha,code.eq.Pezesha')
            .limit(1)
            .maybeSingle();

          if (fixedCompanyError || !fixedCompany?.id) {
            if (mounted) {
              setErrorMessage('Unable to resolve Pezesha company.');
              setLoading(false);
              setRefreshing(false);
            }
            return;
          }

          resolvedCompanyId = String(fixedCompany.id);
        }

        const normalizedRole = normalizeRole(profileData.role);
        const isAgent = normalizedRole === 'agent';
        const collectorScope = String(profileData.name || '').trim();

        let initialQuery = supabase
          .from('ptps')
          .select('*')
          .eq('company_id', resolvedCompanyId)
          .order('created_at', { ascending: false });

        if (isAgent && collectorScope) {
          initialQuery = initialQuery.eq('collector_name', collectorScope);
        }

        const { data: initialRows, error: initialError } = await initialQuery;

        if (initialError) {
          if (mounted) {
            setErrorMessage(`Failed to load PTPs: ${initialError.message}`);
            setLoading(false);
            setRefreshing(false);
          }
          return;
        }

        const overdueOpenPtps = dedupeOperationalRows(
          (initialRows ?? []).filter(
            (row: any) => row.status === 'Promise To Pay' && isPastDue(row.promised_date)
          )
        );

        for (const ptp of overdueOpenPtps) {
          const bookedOn = toDateOnly(ptp.created_at);
          const promisedDate = toDateOnly(ptp.promised_date);

          const { data: paymentRows, error: paymentError } = await supabase
            .from('payments')
            .select('amount, paid_on')
            .eq('account_id', ptp.account_id);

          if (paymentError) continue;

          const paymentsWithinWindow = (paymentRows ?? []).filter((payment: any) => {
            const paidOn = toDateOnly(payment.paid_on);
            if (!paidOn) return false;
            return paidOn >= bookedOn && paidOn <= promisedDate;
          });

          const paidWithinWindow = paymentsWithinWindow.reduce(
            (sum: number, payment: any) => sum + Number(payment.amount || 0),
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

        let rowsQuery = supabase
          .from('ptps')
          .select('*')
          .eq('company_id', resolvedCompanyId)
          .order('created_at', { ascending: false });

        if (isAgent && collectorScope) {
          rowsQuery = rowsQuery.eq('collector_name', collectorScope);
        }

        const { data: ptpRows, error } = await rowsQuery;

        if (error) {
          if (mounted) {
            setErrorMessage(`Failed to load PTPs: ${error.message}`);
            setLoading(false);
            setRefreshing(false);
          }
          return;
        }

        const dedupedPtpRows = dedupeOperationalRows(ptpRows ?? []);

        const accountIds = Array.from(
          new Set(dedupedPtpRows.map((row: any) => row.account_id).filter(Boolean))
        );

        const accountsById = new Map<
          string,
          { cfid: string | null; debtor_name: string | null; status: string | null }
        >();

        const paymentsByAccountId = new Map<
          string,
          Array<{ amount: number | null; paid_on: string | null }>
        >();

        if (accountIds.length > 0) {
          let accountsQuery = supabase
            .from('accounts')
            .select('id, cfid, debtor_name, status, company_id, collector_name')
            .in('id', accountIds)
            .eq('company_id', resolvedCompanyId);

          let paymentsQuery = supabase
            .from('payments')
            .select('account_id, amount, paid_on, company_id, collector_name')
            .in('account_id', accountIds)
            .eq('company_id', resolvedCompanyId);

          if (isAgent && collectorScope) {
            accountsQuery = accountsQuery.eq('collector_name', collectorScope);
            paymentsQuery = paymentsQuery.eq('collector_name', collectorScope);
          }

          const [{ data: accounts }, { data: payments }] = await Promise.all([
            accountsQuery,
            paymentsQuery,
          ]);

          for (const account of accounts ?? []) {
            accountsById.set(String(account.id), {
              cfid: account.cfid ?? null,
              debtor_name: account.debtor_name ?? null,
              status: account.status ?? null,
            });
          }

          for (const payment of payments ?? []) {
            const key = String(payment.account_id || '');
            if (!key) continue;
            const current = paymentsByAccountId.get(key) || [];
            current.push({
              amount: payment.amount ?? null,
              paid_on: payment.paid_on ?? null,
            });
            paymentsByAccountId.set(key, current);
          }
        }

        const normalizedRows = dedupedPtpRows.map((row: any) => {
          const account = row.account_id ? accountsById.get(String(row.account_id)) : null;
          const payments = row.account_id
            ? paymentsByAccountId.get(String(row.account_id)) || []
            : [];

          let effectiveStatus = row.status || '-';
          let effectiveKeptAmount = Number(row.kept_amount || 0);

          const needsDerivedOutcome =
            row.status === 'Promise To Pay' && isPastDue(row.promised_date);

          const needsDerivedKeptAmount =
            row.status === 'Kept' && Number(row.kept_amount || 0) <= 0;

          if (needsDerivedOutcome || needsDerivedKeptAmount) {
            const derived = resolvePtpOutcomeFromPayments(row, payments);

            if (needsDerivedOutcome) {
              effectiveStatus = derived.effectiveStatus;
            }

            if (row.status === 'Kept' || derived.effectiveStatus === 'Kept') {
              effectiveKeptAmount = derived.effectiveKeptAmount;
            }
          }

          return {
            ...row,
            accountMeta: account ?? null,
            effectiveStatus,
            effectiveKeptAmount,
          };
        });

        const nextProfile = {
          id: String(profileData.id),
          name: profileData.name ?? null,
          role: profileData.role ?? null,
          company_id: resolvedCompanyId,
        };

        if (mounted) {
          setProfile(nextProfile);
          setAllRows(normalizedRows);
          setRows(normalizedRows);
          setErrorMessage('');
          setLoading(false);
          setRefreshing(false);
        }

        try {
          const payload: CachedState = {
            profile: nextProfile,
            rows: normalizedRows,
            allRows: normalizedRows,
            cachedAt: new Date().toISOString(),
          };
          window.sessionStorage.setItem(cacheKey, JSON.stringify(payload));
        } catch {
          // ignore cache write errors
        }
      } catch (error: any) {
        if (mounted) {
          setErrorMessage(error?.message || 'Failed to load PTPs.');
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    loadPtps();

    return () => {
      mounted = false;
    };
  }, [searchParams]);

  const filteredRows = useMemo(() => {
    return allRows.filter((row) => {
      if (!filter) return true;
      if (filter === 'open') return row.effectiveStatus === 'Promise To Pay';
      if (filter === 'due-today') {
        return row.effectiveStatus === 'Promise To Pay' && isToday(row.promised_date);
      }
      if (filter === 'kept') return row.effectiveStatus === 'Kept';
      if (filter === 'broken') return row.effectiveStatus === 'Broken';
      return true;
    });
  }, [allRows, filter]);

  const topRows = useMemo(() => filteredRows.slice(0, TOP_TABLE_LIMIT), [filteredRows]);

  const openPtps = useMemo(
    () => allRows.filter((row) => row.effectiveStatus === 'Promise To Pay').length,
    [allRows]
  );

  const keptPtps = useMemo(
    () => allRows.filter((row) => row.effectiveStatus === 'Kept').length,
    [allRows]
  );

  const brokenPtps = useMemo(
    () => allRows.filter((row) => row.effectiveStatus === 'Broken').length,
    [allRows]
  );

  const dueToday = useMemo(
    () =>
      allRows.filter(
        (row) => row.effectiveStatus === 'Promise To Pay' && isToday(row.promised_date)
      ).length,
    [allRows]
  );

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

  const reportRows = useMemo(() => {
    const sixMonthsAgo = monthsAgoDate(6);
    return allRows.filter((row) => {
      const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
      return createdAt >= new Date(sixMonthsAgo).getTime();
    });
  }, [allRows]);

  const agentSummaries = useMemo(() => {
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
      current.totalKeptAmount += Number(row.effectiveKeptAmount || 0);

      if (row.effectiveStatus === 'Promise To Pay') current.openPtps += 1;
      if (row.effectiveStatus === 'Kept') current.keptPtps += 1;
      if (row.effectiveStatus === 'Broken') current.brokenPtps += 1;
      if (row.is_rebooked === true) current.rebookedPtps += 1;

      agentMap.set(collectorName, current);
    }

    return Array.from(agentMap.values())
      .map((row) => {
        const resolved = row.keptPtps + row.brokenPtps;
        return {
          ...row,
          keptRatePct: resolved > 0 ? Number(((row.keptPtps / resolved) * 100).toFixed(2)) : 0,
        };
      })
      .sort((a, b) => a.collectorName.localeCompare(b.collectorName));
  }, [reportRows]);

  const teamSummary = useMemo(() => {
    const teamKeptPtps = reportRows.filter((row) => row.effectiveStatus === 'Kept').length;
    const teamBrokenPtps = reportRows.filter((row) => row.effectiveStatus === 'Broken').length;
    const teamResolved = teamKeptPtps + teamBrokenPtps;

    return {
      totalBooked: reportRows.length,
      openPtps: reportRows.filter((row) => row.effectiveStatus === 'Promise To Pay').length,
      keptPtps: teamKeptPtps,
      brokenPtps: teamBrokenPtps,
      rebookedPtps: reportRows.filter((row) => row.is_rebooked === true).length,
      totalPromisedAmount: reportRows.reduce(
        (sum, row) => sum + Number(row.promised_amount || 0),
        0
      ),
      totalKeptAmount: reportRows.reduce(
        (sum, row) => sum + Number(row.effectiveKeptAmount || 0),
        0
      ),
      keptRatePct: teamResolved > 0 ? Number(((teamKeptPtps / teamResolved) * 100).toFixed(2)) : 0,
    };
  }, [reportRows]);

  const monthlySummaries = useMemo(() => {
    const monthlyMap = new Map<string, MonthlySummaryRow>();

    for (const row of reportRows) {
      const key = monthKeyFromDate(row.created_at);
      if (!key) continue;

      const current = monthlyMap.get(key) || {
        monthKey: key,
        monthLabel: monthLabelFromKey(key),
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
      current.totalKeptAmount += Number(row.effectiveKeptAmount || 0);

      if (row.effectiveStatus === 'Promise To Pay') current.openPtps += 1;
      if (row.effectiveStatus === 'Kept') current.keptPtps += 1;
      if (row.effectiveStatus === 'Broken') current.brokenPtps += 1;
      if (row.is_rebooked === true) current.rebookedPtps += 1;

      monthlyMap.set(key, current);
    }

    return Array.from(monthlyMap.values())
      .map((row) => {
        const resolved = row.keptPtps + row.brokenPtps;
        return {
          ...row,
          keptRatePct: resolved > 0 ? Number(((row.keptPtps / resolved) * 100).toFixed(2)) : 0,
        };
      })
      .sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  }, [reportRows]);

  const isAgent = normalizeRole(profile?.role) === 'agent';

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="text-slate-500">Loading PTPs...</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">PTPs</h1>
        <p className="text-red-600">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold">PTPs</h1>
            {refreshing ? (
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Refreshing…
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-slate-500">
            {isAgent
              ? 'Live promise-to-pay activity for your assigned portfolio.'
              : 'Live promise-to-pay activity linked to account workspaces.'}
          </p>
          {filterLabel ? (
            <p className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              Filter: {filterLabel}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3">
          <a
            href="/api/ptps/report/export"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export Excel
          </a>
        </div>
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
              Showing {topRows.length} of {filteredRows.length} effective PTP records for the selected filter.
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
                <td className="px-4 py-3">{row.effectiveStatus || '-'}</td>
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
          <h2 className="text-lg font-semibold text-slate-900">
            PTP Performance Report — Last 6 Months
          </h2>
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
            <p className="mt-2 text-xl font-semibold text-slate-900">
              {teamSummary.keptRatePct}%
            </p>
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

        <div className="pt-2">
          <h3 className="text-base font-semibold text-slate-900">
            Monthly Trend — Last 6 Months
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Monthly PTP performance trend for the whole team.
          </p>
        </div>

        <DataTable
          headers={[
            'Month',
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
          {monthlySummaries.map((row) => (
            <tr key={row.monthKey}>
              <td className="px-4 py-3 font-medium">{row.monthLabel}</td>
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

        {monthlySummaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
            No monthly PTP history found in the last 6 months.
          </div>
        ) : null}
      </div>
    </div>
  );
}