'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { KpiCard } from '@/components/KpiCard';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency } from '@/lib/utils';

const PAGE_SIZE = 1000;
const DASHBOARD_CACHE_PREFIX = 'dashboard-cache:v1:';

type UserProfile = {
  id: string;
  name?: string | null;
  role: string | null;
  company_id: string | null;
};

type DashboardAccountRow = {
  id: string;
  balance: number | null;
  amount_paid: number | null;
  status: string | null;
  collector_name: string | null;
  product: string | null;
  product_name?: string | null;
  next_action_date: string | null;
  last_action_date: string | null;
};

type DashboardPaymentRow = {
  id: string;
  account_id: string | null;
  amount: number | null;
  paid_on: string | null;
  collector_name?: string | null;
};

type DashboardPtpRow = {
  id: string;
  account_id: string | null;
  collector_name: string | null;
  promised_amount: number | null;
  promised_date: string | null;
  kept_amount: number | null;
  status: string | null;
  created_at: string | null;
};

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function normalizeName(value: string | null | undefined) {
  return String(value || '').trim();
}

function isCurrentMonth(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  const now = new Date();

  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
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

function diffDaysFromToday(dateValue: string | null | undefined) {
  if (!dateValue) return null;

  const iso = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  let target: Date;

  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    target = new Date(year, month - 1, day);
  } else {
    target = new Date(dateValue);
  }

  if (Number.isNaN(target.getTime())) return null;

  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const compare = new Date(target.getFullYear(), target.getMonth(), target.getDate());

  return Math.floor((compare.getTime() - current.getTime()) / 86400000);
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function resolvePtpOutcomeFromPayments(
  ptp: DashboardPtpRow,
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

async function fetchAllRows(
  table: 'accounts' | 'payments' | 'ptps',
  input: {
    companyId: string;
    collectorName?: string;
    restrictToCollector?: boolean;
  }
) {
  if (!supabase) return [];

  const { companyId, collectorName, restrictToCollector } = input;
  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    let query: any;

    if (table === 'accounts') {
      query = supabase
        .from('accounts')
        .select(
          'id,balance,amount_paid,status,collector_name,product,product_name,next_action_date,last_action_date'
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(from, to);
    } else if (table === 'payments') {
      query = supabase
        .from('payments')
        .select('id,account_id,amount,paid_on,collector_name')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(from, to);
    } else {
      query = supabase
        .from('ptps')
        .select(
          'id,account_id,collector_name,promised_amount,promised_date,kept_amount,status,created_at'
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(from, to);
    }

    if (restrictToCollector && collectorName) {
      query = query.eq('collector_name', collectorName);
    }

    const { data, error } = await query;

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

function alertClasses(tone: string) {
  if (tone === 'red') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (tone === 'amber') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (tone === 'blue') {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [accountList, setAccountList] = useState<DashboardAccountRow[]>([]);
  const [payments, setPayments] = useState<DashboardPaymentRow[]>([]);
  const [ptps, setPtps] = useState<DashboardPtpRow[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [resolvedCompanyId, setResolvedCompanyId] = useState('');
  const [companyResolved, setCompanyResolved] = useState(false);

  const normalizedProfileRole = normalizeRole(profile?.role);
  const normalizedProfileName = normalizeName(profile?.name);
  const isAgent = normalizedProfileRole === 'agent';

  const dashboardCacheKey = useMemo(() => {
    const companyId =
      String(resolvedCompanyId || profile?.company_id || '').trim() || 'pending-company';
    const role = normalizedProfileRole || 'unknown-role';
    const name = normalizedProfileName || 'unknown-user';
    return `${DASHBOARD_CACHE_PREFIX}${companyId}:${role}:${name}`;
  }, [resolvedCompanyId, profile?.company_id, normalizedProfileRole, normalizedProfileName]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(dashboardCacheKey);

      if (!raw) {
        setCacheHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw);

      if (parsed?.profile) setProfile(parsed.profile);
      if (Array.isArray(parsed?.accountList)) setAccountList(parsed.accountList);
      if (Array.isArray(parsed?.payments)) setPayments(parsed.payments);
      if (Array.isArray(parsed?.ptps)) setPtps(parsed.ptps);

      if (typeof parsed?.resolvedCompanyId === 'string' && parsed.resolvedCompanyId.trim()) {
        setResolvedCompanyId(parsed.resolvedCompanyId);
        setCompanyResolved(true);
      }

      if (
        parsed?.profile ||
        Array.isArray(parsed?.accountList) ||
        Array.isArray(parsed?.payments) ||
        Array.isArray(parsed?.ptps)
      ) {
        setRestoredFromCache(true);
        setLoadingData(false);
      }
    } catch {
      // ignore cache errors
    } finally {
      setCacheHydrated(true);
    }
  }, [dashboardCacheKey]);

  useEffect(() => {
    let mounted = true;

    async function loadCompanyContext() {
      try {
        if (!supabase) {
          if (mounted) {
            if (!restoredFromCache) {
              setSessionError('Supabase client is not configured.');
            }
            setCompanyResolved(true);
            setLoadingProfile(false);
          }
          return;
        }

        const firstSessionResult = await supabase.auth.getSession();

        let session = firstSessionResult.data.session;
        let sessionLoadError = firstSessionResult.error;

        if (!session && !sessionLoadError) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));

          const secondSessionResult = await supabase.auth.getSession();
          session = secondSessionResult.data.session;
          sessionLoadError = secondSessionResult.error;
        }

        if (!mounted) return;

        if (sessionLoadError) {
          if (!restoredFromCache) {
            setSessionError('Unable to load user session.');
          }
          setCompanyResolved(true);
          setLoadingProfile(false);
          return;
        }

        const userId = session?.user?.id;
        if (!userId) {
          if (!restoredFromCache) {
            setSessionError('Unable to load user session.');
          }
          setCompanyResolved(true);
          setLoadingProfile(false);
          return;
        }

        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('company_id')
          .eq('id', userId)
          .maybeSingle();

        if (!mounted) return;

        if (profileError) {
          if (!restoredFromCache) {
            setSessionError(profileError.message || 'Unable to resolve company context.');
          }
          setCompanyResolved(true);
          setLoadingProfile(false);
          return;
        }

        let companyId = String(profileData?.company_id || '').trim();

        if (!companyId) {
          const { data: fixedCompany, error: fixedCompanyError } = await supabase
            .from('companies')
            .select('id,name,code')
            .or('name.eq.Pezesha,code.eq.Pezesha')
            .limit(1)
            .maybeSingle();

          if (!mounted) return;

          if (fixedCompanyError || !fixedCompany?.id) {
            if (!restoredFromCache) {
              setSessionError('Unable to resolve Pezesha company.');
            }
            setCompanyResolved(true);
            setLoadingProfile(false);
            return;
          }

          companyId = String(fixedCompany.id);
        }

        if (!mounted) return;

        setResolvedCompanyId(companyId);
        setCompanyResolved(true);
        setSessionError(null);
      } catch (error: any) {
        if (!mounted) return;

        if (!restoredFromCache) {
          setSessionError(error?.message || 'Unable to resolve company context.');
        }
        setCompanyResolved(true);
        setLoadingProfile(false);
      }
    }

    loadCompanyContext();

    return () => {
      mounted = false;
    };
  }, [restoredFromCache]);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      try {
        if (!cacheHydrated || !companyResolved) {
          return;
        }

        if (!supabase) {
          if (mounted) {
            if (!profile && !restoredFromCache) {
              setSessionError('Supabase client is not configured.');
            }
            setLoadingProfile(false);
          }
          return;
        }

        if (!resolvedCompanyId) {
          if (mounted) {
            if (!profile && !restoredFromCache) {
              setSessionError('Unable to resolve Pezesha company.');
            }
            setLoadingProfile(false);
          }
          return;
        }

        const firstSessionResult = await supabase.auth.getSession();

        let session = firstSessionResult.data.session;
        let sessionLoadError = firstSessionResult.error;

        if (!session && !sessionLoadError) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));

          const secondSessionResult = await supabase.auth.getSession();
          session = secondSessionResult.data.session;
          sessionLoadError = secondSessionResult.error;
        }

        if (!mounted) return;

        if (sessionLoadError) {
          if (!profile && !restoredFromCache) {
            setSessionError('Unable to load user session.');
          }
          setLoadingProfile(false);
          return;
        }

        const userId = session?.user?.id;
        if (!userId) {
          if (!profile && !restoredFromCache) {
            setSessionError('Unable to load user session.');
          }
          setLoadingProfile(false);
          return;
        }

        const { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id,name,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (!mounted) return;

        if (profileError || !profileData?.id) {
          if (!profile && !restoredFromCache) {
            setSessionError('Unable to load user session.');
          }
          setLoadingProfile(false);
          return;
        }

        setProfile({
          id: String(profileData.id),
          name: profileData.name ?? null,
          role: profileData.role ?? null,
          company_id: resolvedCompanyId,
        });
        setSessionError(null);
        setLoadingProfile(false);
      } catch (error: any) {
        if (!mounted) return;

        if (!profile && !restoredFromCache) {
          setSessionError(error?.message || 'Unable to load user session.');
        }
        setLoadingProfile(false);
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [cacheHydrated, companyResolved, resolvedCompanyId, restoredFromCache]);

  useEffect(() => {
    let mounted = true;

    async function loadDashboardData() {
      if (loadingProfile || !cacheHydrated || !companyResolved) return;

      if (!resolvedCompanyId) {
        if (mounted) {
          if (accountList.length === 0 && ptps.length === 0) {
            setLoadingData(false);
          } else {
            setIsRefreshing(false);
          }
        }
        return;
      }

      try {
        if (accountList.length === 0 && ptps.length === 0) {
          setLoadingData(true);
        } else {
          setIsRefreshing(true);
        }

        setDataError(null);

        const collectorScope = normalizedProfileName;

        const [accountsRows, paymentsRows, ptpRows] = await Promise.all([
          fetchAllRows('accounts', {
            companyId: resolvedCompanyId,
            collectorName: collectorScope,
            restrictToCollector: isAgent,
          }),
          fetchAllRows('payments', {
            companyId: resolvedCompanyId,
            collectorName: collectorScope,
            restrictToCollector: isAgent,
          }),
          fetchAllRows('ptps', {
            companyId: resolvedCompanyId,
            collectorName: collectorScope,
            restrictToCollector: isAgent,
          }),
        ]);

        if (mounted) {
          setAccountList(accountsRows as DashboardAccountRow[]);
          setPayments(paymentsRows as DashboardPaymentRow[]);
          setPtps(ptpRows as DashboardPtpRow[]);
          setLoadingData(false);
          setIsRefreshing(false);
          setRestoredFromCache(false);
        }
      } catch (error: any) {
        if (mounted) {
          setDataError(error?.message || 'Unknown error');
          setLoadingData(false);
          setIsRefreshing(false);
        }
      }
    }

    loadDashboardData();

    return () => {
      mounted = false;
    };
  }, [
    loadingProfile,
    cacheHydrated,
    companyResolved,
    resolvedCompanyId,
    isAgent,
    normalizedProfileName,
  ]);

  useEffect(() => {
    if (!cacheHydrated) return;

    try {
      sessionStorage.setItem(
        dashboardCacheKey,
        JSON.stringify({
          profile,
          resolvedCompanyId,
          accountList,
          payments,
          ptps,
          savedAt: Date.now(),
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [dashboardCacheKey, profile, resolvedCompanyId, accountList, payments, ptps, cacheHydrated]);

  if (
    (loadingProfile || loadingData) &&
    !restoredFromCache &&
    !profile &&
    accountList.length === 0 &&
    ptps.length === 0
  ) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
          {isRefreshing ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              Refreshing…
            </span>
          ) : null}
        </div>

        <p className="text-slate-500">Loading dashboard...</p>
      </div>
    );
  }

  if (sessionError && !profile && !restoredFromCache && accountList.length === 0 && ptps.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
          {isRefreshing ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              Refreshing…
            </span>
          ) : null}
        </div>
        <p className="text-red-600">{sessionError}</p>
      </div>
    );
  }

  if (!resolvedCompanyId && !restoredFromCache && accountList.length === 0 && ptps.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-red-600">Unable to load user session.</p>
      </div>
    );
  }

  const paymentsByAccountId = new Map<
    string,
    Array<{ amount: number | null; paid_on: string | null; collector_name?: string | null }>
  >();

  for (const payment of payments) {
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

  const normalizedPtps = ptps.map((ptp) => {
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

  const totalAccounts = accountList.length;
  const outstanding = accountList.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const totalCollected = accountList.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);

  const collectedThisMonthFromPayments = payments
    .filter((item) => isCurrentMonth(item.paid_on))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const collectedThisMonth =
    collectedThisMonthFromPayments > 0
      ? collectedThisMonthFromPayments
      : accountList
          .filter((item) => isCurrentMonth(item.last_action_date))
          .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);

  const openPtpAccountIds = new Set(
    normalizedPtps
      .filter((ptp) => ptp.effectiveStatus === 'Promise To Pay' && ptp.account_id)
      .map((ptp) => ptp.account_id)
  );

  const dueTodayPtpAccountIds = new Set(
    normalizedPtps
      .filter(
        (ptp) =>
          ptp.effectiveStatus === 'Promise To Pay' &&
          ptp.account_id &&
          isToday(ptp.promised_date)
      )
      .map((ptp) => ptp.account_id)
  );

  const openPtps = openPtpAccountIds.size;
  const ptpsDueToday = dueTodayPtpAccountIds.size;

  const keptPtps = normalizedPtps.filter((ptp) => ptp.effectiveStatus === 'Kept').length;
  const brokenPtps = normalizedPtps.filter((ptp) => ptp.effectiveStatus === 'Broken').length;

  const resolvedPtps = normalizedPtps.filter(
    (ptp) => ptp.effectiveStatus === 'Kept' || ptp.effectiveStatus === 'Broken'
  ).length;

  const escalatedAccounts = accountList.filter((item) => item.status === 'Escalated').length;
  const paidAccounts = accountList.filter((item) => Number(item.amount_paid || 0) > 0).length;
  const openAccounts = accountList.filter((item) => Number(item.amount_paid || 0) <= 0).length;

  const activeCollectors = new Set(
    accountList.map((item) => item.collector_name).filter(Boolean)
  ).size;

  const totalAssignedValue = outstanding + totalCollected;
  const collectionRate = totalAssignedValue > 0 ? (totalCollected / totalAssignedValue) * 100 : 0;

  const ptpKeptRate = resolvedPtps > 0 ? (keptPtps / resolvedPtps) * 100 : 0;
  const ptpConversionRate =
    normalizedPtps.length > 0 ? (keptPtps / normalizedPtps.length) * 100 : 0;

  const collectors = Array.from(
    new Set(accountList.map((item) => item.collector_name).filter(Boolean))
  );

  const collectorPerformance = collectors.map((collector) => {
    const collectorAccounts = accountList.filter((item) => item.collector_name === collector);

    const collectorCollected = collectorAccounts.reduce(
      (sum, item) => sum + Number(item.amount_paid || 0),
      0
    );

    const collectorPtps = normalizedPtps.filter((ptp) => ptp.collector_name === collector);

    const collectorOpenPtpAccounts = new Set(
      collectorPtps
        .filter((ptp) => ptp.effectiveStatus === 'Promise To Pay' && ptp.account_id)
        .map((ptp) => ptp.account_id)
    );

    const collectorKeptPtps = collectorPtps.filter(
      (ptp) => ptp.effectiveStatus === 'Kept'
    ).length;

    const collectorBrokenPtps = collectorPtps.filter(
      (ptp) => ptp.effectiveStatus === 'Broken'
    ).length;

    const collectorResolvedPtps = collectorPtps.filter(
      (ptp) => ptp.effectiveStatus === 'Kept' || ptp.effectiveStatus === 'Broken'
    ).length;

    return {
      collector,
      assignedAccounts: collectorAccounts.length,
      totalBalance: collectorAccounts.reduce((sum, item) => sum + Number(item.balance || 0), 0),
      totalCollected: collectorCollected,
      openPtps: collectorOpenPtpAccounts.size,
      keptPtps: collectorKeptPtps,
      brokenPtps: collectorBrokenPtps,
      ptpKeptRate:
        collectorResolvedPtps > 0
          ? formatPercent((collectorKeptPtps / collectorResolvedPtps) * 100)
          : '0.0%',
      callbacks: collectorAccounts.filter((account) => account.status === 'Callback Requested')
        .length,
    };
  });

  const accountProducts = Array.from(
    new Set(
      accountList
        .map((item) => String(item.product || item.product_name || '').trim())
        .filter(Boolean)
    )
  );

  const accountCoverage = accountProducts.map((product) => {
    const productAccounts = accountList.filter((item) => {
      const productName = String(item.product || item.product_name || '').trim();
      return productName === product;
    });

    return {
      product,
      accounts: productAccounts.length,
      balance: productAccounts.reduce((sum, item) => sum + Number(item.balance || 0), 0),
    };
  });

  const paymentCoverage = accountProducts.map((product) => {
    const productAccounts = accountList.filter((item) => {
      const productName = String(item.product || item.product_name || '').trim();
      return productName === product;
    });

    const paidProductAccounts = productAccounts.filter(
      (item) => Number(item.amount_paid || 0) > 0
    );

    return {
      product,
      paymentsCount: paidProductAccounts.length,
      collected: paidProductAccounts.reduce(
        (sum, item) => sum + Number(item.amount_paid || 0),
        0
      ),
      hasPayments: paidProductAccounts.length > 0,
    };
  });

  const callbacksToday = accountList.filter(
    (item) =>
      item.status === 'Callback Requested' &&
      item.next_action_date &&
      isToday(item.next_action_date)
  );

  const overdueCallbacks = accountList.filter((item) => {
    if (item.status !== 'Callback Requested' || !item.next_action_date) return false;
    const diff = diffDaysFromToday(item.next_action_date);
    return diff !== null && diff < 0;
  });

  const nextActionDueToday = accountList.filter(
    (item) => item.next_action_date && isToday(item.next_action_date)
  );

  const staleAccounts = accountList.filter((item) => {
    if (!item.last_action_date) return true;
    const diff = diffDaysFromToday(item.last_action_date);
    return diff !== null && diff <= -3;
  });

  const brokenPtpAccounts = normalizedPtps.filter(
    (ptp) => ptp.effectiveStatus === 'Broken'
  );

  const todayWorkQueue = [
    {
      title: isAgent ? 'My PTPs Due Today' : 'PTPs Due Today',
      count: ptpsDueToday,
      href: '/accounts?filter=ptps-due-today',
      helper: isAgent
        ? 'Promises in your assigned portfolio due today'
        : 'Promises requiring follow-up today',
    },
    {
      title: isAgent ? 'My Callbacks Due Today' : 'Callbacks Due Today',
      count: callbacksToday.length,
      href: '/accounts?status=Callback%20Requested',
      helper: isAgent
        ? 'Your scheduled callbacks due today'
        : 'Accounts awaiting scheduled callbacks',
    },
    {
      title: isAgent ? 'My Next Actions Due Today' : 'Next Actions Due Today',
      count: nextActionDueToday.length,
      href: '/accounts',
      helper: isAgent
        ? 'Your follow-up dates due today'
        : 'Accounts with follow-up dates due today',
    },
    {
      title: isAgent ? 'My Broken PTP Follow-ups' : 'Broken PTP Follow-ups',
      count: brokenPtpAccounts.length,
      href: '/ptps?filter=broken',
      helper: isAgent
        ? 'Broken promises in your assigned accounts'
        : 'Promises that have broken and need action',
    },
    {
      title: isAgent ? 'My Overdue Callbacks' : 'Overdue Callbacks',
      count: overdueCallbacks.length,
      href: '/accounts?status=Callback%20Requested',
      helper: isAgent
        ? 'Missed callbacks in your portfolio'
        : 'Callback actions missed and still pending',
    },
    {
      title: isAgent ? 'My Stale Accounts' : 'Stale Accounts',
      count: staleAccounts.length,
      href: '/accounts',
      helper: isAgent
        ? 'Assigned accounts with no recent action in 3+ days'
        : 'Accounts with no recent action in 3+ days',
    },
  ];

  const alerts = [
    {
      title: isAgent ? 'Broken PTPs need your attention' : 'Broken PTPs need attention',
      count: brokenPtpAccounts.length,
      tone: brokenPtpAccounts.length > 0 ? 'red' : 'slate',
      href: '/ptps?filter=broken',
    },
    {
      title: isAgent ? 'Your callbacks overdue' : 'Callbacks overdue',
      count: overdueCallbacks.length,
      tone: overdueCallbacks.length > 0 ? 'amber' : 'slate',
      href: '/accounts?status=Callback%20Requested',
    },
    {
      title: isAgent ? 'Your PTPs due today' : 'PTPs due today',
      count: ptpsDueToday,
      tone: ptpsDueToday > 0 ? 'blue' : 'slate',
      href: '/accounts?filter=ptps-due-today',
    },
    {
      title: isAgent ? 'Your stale accounts' : 'Stale accounts',
      count: staleAccounts.length,
      tone: staleAccounts.length > 0 ? 'amber' : 'slate',
      href: '/accounts',
    },
  ];

  const quickViews = [
    {
      label: isAgent ? 'My Open PTP Accounts' : 'Open PTP Accounts',
      href: '/accounts?filter=open-ptps',
      helper: isAgent
        ? 'Work all active promise accounts assigned to you'
        : 'Work all active promise accounts',
    },
    {
      label: isAgent ? 'My PTPs Due Today' : 'PTPs Due Today',
      href: '/accounts?filter=ptps-due-today',
      helper: isAgent ? 'Focus on your promises due today' : 'Focus on today’s due promises',
    },
    {
      label: isAgent ? 'My Broken PTP Report' : 'Broken PTP Report',
      href: '/ptps?filter=broken',
      helper: isAgent
        ? 'Review broken promises in your portfolio'
        : 'Review all broken promises',
    },
    {
      label: isAgent ? 'My Kept PTP Report' : 'Kept PTP Report',
      href: '/ptps?filter=kept',
      helper: isAgent
        ? 'Review successful promises kept in your portfolio'
        : 'Review successful promises kept',
    },
    {
      label: isAgent ? 'My Payments Report' : 'Payments Report',
      href: '/payments',
      helper: isAgent ? 'Track payment activity on your accounts' : 'Track payment activity',
    },
    {
      label: isAgent ? 'My Portfolio View' : 'Portfolio View',
      href: '/accounts',
      helper: isAgent ? 'Open your assigned accounts portfolio' : 'Open the full collections portfolio',
    },
  ];

  const portfolioAnalysisGroups = [
    {
      category: 'Accounts',
      rows: [
        { metric: isAgent ? 'My Accounts' : 'Total Accounts', value: totalAccounts.toLocaleString() },
        { metric: 'Paid Accounts', value: paidAccounts.toLocaleString() },
        { metric: 'Open Accounts', value: openAccounts.toLocaleString() },
      ],
    },
    {
      category: 'Exposure',
      rows: [
        { metric: 'Total Outstanding', value: currency(outstanding) },
        { metric: 'Total Collected', value: currency(totalCollected) },
        { metric: 'Collection Rate', value: formatPercent(collectionRate) },
      ],
    },
    {
      category: 'PTP Performance',
      rows: [
        { metric: 'Open PTP Accounts', value: openPtps.toLocaleString() },
        { metric: 'PTP Accounts Due Today', value: ptpsDueToday.toLocaleString() },
        { metric: 'Kept PTPs', value: keptPtps.toLocaleString() },
        { metric: 'Broken PTPs', value: brokenPtps.toLocaleString() },
        { metric: 'PTP Kept Rate', value: formatPercent(ptpKeptRate) },
        { metric: 'PTP Conversion Rate', value: formatPercent(ptpConversionRate) },
      ],
    },
    {
      category: 'Follow-up',
      rows: [{ metric: 'Escalated Accounts', value: escalatedAccounts.toLocaleString() }],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
          {isRefreshing ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              Refreshing…
            </span>
          ) : null}
        </div>

        {restoredFromCache ? (
          <p className="mt-2 text-sm text-slate-500">
            Restored your last dashboard view while the latest data loads.
          </p>
        ) : null}

        <p className="mt-1 text-slate-500">
          {isAgent
            ? 'Collections performance overview for your assigned portfolio.'
            : 'Collections performance overview for your current tenant workspace.'}
        </p>
        {isAgent ? (
          <p className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
            Agent view: dashboard is limited to your allocated accounts
          </p>
        ) : null}
        {dataError ? <p className="mt-2 text-sm text-red-600">{dataError}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          title={isAgent ? 'My Portfolio Outstanding' : 'Portfolio Outstanding'}
          value={outstanding}
          helper={isAgent ? 'Live total balance on your accounts' : 'Live total balance'}
          money
        />
        <KpiCard
          title="Collected to Date"
          value={totalCollected}
          helper={isAgent ? 'Payments logged on your accounts' : 'All payments logged'}
          money
        />
        <KpiCard
          title="Collected This Month"
          value={collectedThisMonth}
          helper="Payments made this month"
          money
        />

        <Link href="/accounts?filter=open-ptps" className="block">
          <KpiCard
            title={isAgent ? 'My Open PTP Accounts' : 'Open PTP Accounts'}
            value={openPtps}
            helper={isAgent ? 'Assigned accounts with active promises' : 'Accounts with active promises'}
          />
        </Link>

        <Link href="/accounts?filter=ptps-due-today" className="block">
          <KpiCard
            title={isAgent ? 'My PTPs Due Today' : 'PTP Accounts Due Today'}
            value={ptpsDueToday}
            helper={isAgent ? 'Your promises due today' : 'Accounts with promises due today'}
          />
        </Link>

        <KpiCard
          title={isAgent ? 'My Active Allocation' : 'Active Collectors'}
          value={isAgent ? totalAccounts : activeCollectors}
          helper={isAgent ? 'Accounts currently assigned to you' : 'Collectors with assigned cases'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Today’s Work Queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Priority actions that should be focused on today.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {todayWorkQueue.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white hover:shadow-sm"
              >
                <p className="text-sm font-medium text-slate-700">{item.title}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900">{item.count}</p>
                <p className="mt-2 text-xs text-slate-500">{item.helper}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Smart Alerts</h2>
              <p className="mt-1 text-sm text-slate-500">
                Operational alerts that need immediate attention.
              </p>
            </div>

            <div className="space-y-3">
              {alerts.map((alert) => (
                <Link
                  key={alert.title}
                  href={alert.href}
                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${alertClasses(
                    alert.tone
                  )}`}
                >
                  <span className="text-sm font-medium">{alert.title}</span>
                  <span className="text-lg font-semibold">{alert.count}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Quick Work Views</h2>
              <p className="mt-1 text-sm text-slate-500">
                Fast access to the most-used operational views.
              </p>
            </div>

            <div className="space-y-3">
              {quickViews.map((view) => (
                <Link
                  key={view.label}
                  href={view.href}
                  className="block rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:bg-white hover:shadow-sm"
                >
                  <p className="text-sm font-medium text-slate-800">{view.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{view.helper}</p>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div>
            <h2 className="section-title mb-3">Portfolio Analysis Summary</h2>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Metric</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolioAnalysisGroups.flatMap((group) => [
                    <tr key={`${group.category}-header`} className="border-b border-slate-200">
                      <td
                        colSpan={2}
                        className="bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-900"
                      >
                        {group.category}
                      </td>
                    </tr>,
                    ...group.rows.map((row) => (
                      <tr
                        key={`${group.category}-${row.metric}`}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-4 py-3 text-slate-700">{row.metric}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.value}</td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </div>

          {!isAgent ? (
            <div>
              <h2 className="section-title mb-3">Collector Scorecard</h2>
              <DataTable
                headers={[
                  'Collector',
                  'Assigned',
                  'Total Collected',
                  'Open PTP Accounts',
                  'Kept PTPs',
                  'Broken PTPs',
                  'PTP Kept Rate',
                  'Callbacks',
                ]}
              >
                {collectorPerformance.map((item) => (
                  <tr key={item.collector}>
                    <td className="px-4 py-3 font-medium">{item.collector}</td>
                    <td className="px-4 py-3">{item.assignedAccounts}</td>
                    <td className="px-4 py-3">{currency(item.totalCollected)}</td>
                    <td className="px-4 py-3">{item.openPtps}</td>
                    <td className="px-4 py-3">{item.keptPtps}</td>
                    <td className="px-4 py-3">{item.brokenPtps}</td>
                    <td className="px-4 py-3">{item.ptpKeptRate}</td>
                    <td className="px-4 py-3">{item.callbacks}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <div className="card p-6">
            <h2 className="section-title">Accounts Coverage by Product</h2>
            <div className="mt-4">
              <DataTable headers={['Product', 'Accounts', 'Balance']}>
                {accountCoverage.map((row) => (
                  <tr key={row.product}>
                    <td className="px-4 py-3 font-medium">{row.product}</td>
                    <td className="px-4 py-3">{row.accounts}</td>
                    <td className="px-4 py-3">{currency(row.balance)}</td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </div>

          <div className="card p-6">
            <h2 className="section-title">Payments Coverage by Product</h2>
            <div className="mt-4">
              <DataTable headers={['Product', 'Payments', 'Collected', 'Coverage']}>
                {paymentCoverage.map((row) => (
                  <tr key={row.product}>
                    <td className="px-4 py-3 font-medium">{row.product}</td>
                    <td className="px-4 py-3">{row.paymentsCount}</td>
                    <td className="px-4 py-3">{currency(row.collected)}</td>
                    <td className="px-4 py-3">
                      {row.hasPayments ? 'Payments logged' : 'No payments logged yet'}
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}