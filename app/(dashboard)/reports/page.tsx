'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency } from '@/lib/utils';

const PAGE_SIZE = 1000;
const COLLECTOR_PAGE_SIZE = 15;
const REPORTS_CACHE_PREFIX = 'reports-cache:v1:';

type AuthProfile = {
  id: string;
  name: string | null;
  email: string | null;
  company_id: string | null;
  role: string | null;
};

type ReportState = {
  accounts: any[];
  payments: any[];
  ptps: any[];
  loaded: boolean;
  error: string | null;
};

type ActiveTab = 'overview' | 'early_warning' | 'roll_rates';
type WarningPriority = 'Critical' | 'High' | 'Medium' | 'Low';
type RolloverFilter = 'all' | '3' | '2' | '1';
type RollRateWindow = 'current_month' | 'last_30_days' | 'custom';
type RollRateWeek = 'Week 1' | 'Week 2' | 'Week 3' | 'Week 4' | 'Week 5';

type RollRateRow = {
  collector: string;
  week: RollRateWeek;
  bucket: string;
  nextBucket: string;
  accountsInBucket: number;
  accountsAtRisk: number;
  valueInBucket: number;
  valueAtRisk: number;
  rollRateCount: number;
  rollRateValue: number;
  highRiskAgent: boolean;
};

type EarlyWarningRow = {
  id: string;
  cfid: string;
  debtorName: string;
  collector: string;
  product: string;
  currentBucket: string;
  nextBucket: string;
  daysToRollover: number;
  dueDate: string;
  balance: number;
  amountPaid: number;
  disposition: string;
  ptpStatus: string;
  priority: WarningPriority;
  score: number;
  suggestedAction: string;
  rawStatus: string;
};

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function isCurrentMonth(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  const now = new Date();

  return (
    !Number.isNaN(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseInputDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function daysBetween(start: Date, end: Date) {
  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function clampRangeToNinetyDays(start: Date, end: Date) {
  const diff = daysBetween(start, end);
  if (diff <= 92) return { start, end };

  const cappedEnd = new Date(start);
  cappedEnd.setDate(cappedEnd.getDate() + 92);
  return { start, end: cappedEnd };
}

function parseDateOnly(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function getWeekOfMonth(dateValue: string | null | undefined): RollRateWeek | null {
  const date = parseDateOnly(dateValue);
  if (!date) return null;

  const day = date.getDate();

  if (day <= 7) return 'Week 1';
  if (day <= 14) return 'Week 2';
  if (day <= 21) return 'Week 3';
  if (day <= 28) return 'Week 4';
  return 'Week 5';
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

function daysUntil(dateValue: string | null | undefined) {
  const target = parseDateOnly(dateValue);
  if (!target) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = target.getTime() - today.getTime();

  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function getBucketLabel(dpdValue: unknown) {
  const dpd = Number(dpdValue || 0);

  if (!Number.isFinite(dpd) || dpd <= 0) return '0-30';
  if (dpd <= 30) return '0-30';
  if (dpd <= 60) return '31-60';
  if (dpd <= 90) return '61-90';
  if (dpd <= 120) return '91-120';
  return '121+';
}

function getNextBucketLabel(bucket: string) {
  if (bucket === '0-30') return '31-60';
  if (bucket === '31-60') return '61-90';
  if (bucket === '61-90') return '91-120';
  if (bucket === '91-120') return '121+';
  return '121+';
}

function isUnreachableAccount(account: any) {
  const contactability = normalizeText(account.contactability || account.reachability).toLowerCase();
  const status = normalizeText(account.status).toLowerCase();

  return (
    contactability.includes('unreach') ||
    contactability.includes('not reach') ||
    status.includes('unreach')
  );
}

function getPtpStatusForAccount(accountId: string, ptps: any[]) {
  const related = ptps
    .filter((ptp) => String(ptp.account_id || '') === accountId)
    .sort((a, b) => {
      const aDate = new Date(a.created_at || a.updated_at || 0).getTime();
      const bDate = new Date(b.created_at || b.updated_at || 0).getTime();
      return bDate - aDate;
    });

  if (!related.length) return 'No PTP';

  const latest = related[0];
  const resolution = normalizeText(latest.resolution_type).toLowerCase();
  const status = normalizeText(latest.status);

  if (resolution === 'broken') return 'Broken';
  if (resolution === 'kept') return 'Kept';
  if (status === 'Promise To Pay') return 'Promise To Pay';

  return status || 'PTP Logged';
}

function getDispositionLabel(account: any) {
  const contactability = normalizeText(account.contactability || account.reachability);
  const status = normalizeText(account.status);

  if (contactability) return contactability;
  if (status) return status;

  return 'Unknown';
}

function getPriorityMeta(input: {
  account: any;
  daysToRollover: number;
  ptpStatus: string;
}) {
  const { account, daysToRollover, ptpStatus } = input;

  let score = 0;
  const lowerStatus = normalizeText(account.status).toLowerCase();
  const unreachable = isUnreachableAccount(account);
  const brokenPtp = ptpStatus === 'Broken';
  const callbackRequested = lowerStatus.includes('callback');

  if (daysToRollover === 1) score += 35;
  if (daysToRollover === 2) score += 25;
  if (daysToRollover === 3) score += 15;

  if (unreachable) score += 40;
  if (brokenPtp) score += 30;
  if (callbackRequested) score += 15;
  if (Number(account.amount_paid || 0) <= 0) score += 10;
  if (Number(account.balance || 0) > 0) score += 5;

  let priority: WarningPriority = 'Low';

  if (score >= 70) {
    priority = 'Critical';
  } else if (score >= 50) {
    priority = 'High';
  } else if (score >= 30) {
    priority = 'Medium';
  }

  let suggestedAction = 'Review account before next rollover window.';

  if (unreachable && daysToRollover <= 2) {
    suggestedAction = 'Highest priority: escalate unreachable debtor before rollover.';
  } else if (brokenPtp && daysToRollover <= 2) {
    suggestedAction = 'Follow up immediately on broken PTP before bucket deterioration.';
  } else if (callbackRequested && daysToRollover <= 2) {
    suggestedAction = 'Complete callback urgently before rollover.';
  } else if (daysToRollover === 1) {
    suggestedAction = 'Immediate action required today to prevent rollover tomorrow.';
  }

  return { score, priority, suggestedAction };
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

    let query = supabase
      .from(table)
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .range(from, to);

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

export default function ReportsPageWrapper() {
  return <ReportsPageClient />;
}

function ReportsPageClient() {
  const [reportData, setReportData] = useState<ReportState>({
    accounts: [],
    payments: [],
    ptps: [],
    loaded: false,
    error: null,
  });

  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [collectorPage, setCollectorPage] = useState(1);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const searchParams = useSearchParams();
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<'all' | WarningPriority>('all');
  const [rolloverFilter, setRolloverFilter] = useState<RolloverFilter>('all');
  const [collectorFilter, setCollectorFilter] = useState('all');
  const [rollRateWindow, setRollRateWindow] = useState<RollRateWindow>('current_month');
  const [rollRateStartDate, setRollRateStartDate] = useState(
    toDateInputValue(startOfMonth(new Date()))
  );
  const [rollRateEndDate, setRollRateEndDate] = useState(
    toDateInputValue(endOfMonth(new Date()))
  );

  const reportsCacheKey = useMemo(() => {
    const companyId = normalizeText(profile?.company_id) || 'pending-company';
    const role = normalizeRole(profile?.role);
    const name = normalizeText(profile?.name) || 'unknown-user';
    return `${REPORTS_CACHE_PREFIX}${companyId}:${role}:${name}`;
  }, [profile?.company_id, profile?.role, profile?.name]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(reportsCacheKey);

      if (!raw) {
        setCacheHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw);

      if (parsed?.profile) setProfile(parsed.profile);
      if (parsed?.reportData) setReportData(parsed.reportData);
      if (parsed?.activeTab) setActiveTab(parsed.activeTab);
      if (parsed?.priorityFilter) setPriorityFilter(parsed.priorityFilter);
      if (parsed?.rolloverFilter) setRolloverFilter(parsed.rolloverFilter);
      if (parsed?.collectorFilter) setCollectorFilter(parsed.collectorFilter);
      if (parsed?.rollRateWindow) setRollRateWindow(parsed.rollRateWindow);
      if (parsed?.rollRateStartDate) setRollRateStartDate(parsed.rollRateStartDate);
      if (parsed?.rollRateEndDate) setRollRateEndDate(parsed.rollRateEndDate);

      if (parsed?.reportData?.loaded) {
        setRestoredFromCache(true);
      }
    } catch {
      // ignore cache errors
    } finally {
      setCacheHydrated(true);
    }
  }, [reportsCacheKey]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');

    if (requestedTab === 'early_warning') {
      setActiveTab('early_warning');
      return;
    }

    if (requestedTab === 'roll_rates') {
      setActiveTab('roll_rates');
      return;
    }

    if (requestedTab === 'overview') {
      setActiveTab('overview');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!cacheHydrated) return;

    try {
      sessionStorage.setItem(
        reportsCacheKey,
        JSON.stringify({
          profile,
          reportData,
          activeTab,
          priorityFilter,
          rolloverFilter,
          collectorFilter,
          rollRateWindow,
          rollRateStartDate,
          rollRateEndDate,
          savedAt: Date.now(),
        })
      );
    } catch {
      // ignore cache errors
    }
  }, [
    reportsCacheKey,
    profile,
    reportData,
    activeTab,
    priorityFilter,
    rolloverFilter,
    collectorFilter,
    rollRateWindow,
    rollRateStartDate,
    rollRateEndDate,
    cacheHydrated,
  ]);

  useEffect(() => {
    if (!cacheHydrated) return;

    let mounted = true;

    (async () => {
      if (!supabase) {
        if (mounted) {
          setReportData({
            accounts: [],
            payments: [],
            ptps: [],
            loaded: true,
            error: 'Supabase is not configured.',
          });
        }
        return;
      }

      try {
        if (!reportData.loaded) {
          setReportData((prev) => ({ ...prev, error: null }));
        } else {
          setIsRefreshing(true);
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!mounted) return;

        if (sessionError) {
          setReportData((prev) => ({
            ...prev,
            loaded: true,
            error: sessionError.message || 'Unable to load user session.',
          }));
          setIsRefreshing(false);
          return;
        }

        const userId = session?.user?.id;
        if (!userId) {
          setReportData((prev) => ({
            ...prev,
            loaded: true,
            error: 'Unable to load user session.',
          }));
          setIsRefreshing(false);
          return;
        }

        const { data: userProfile, error: profileError } = await supabase
          .from('user_profiles')
          .select('id,name,email,company_id,role')
          .eq('id', userId)
          .maybeSingle();

        if (!mounted) return;

        if (profileError || !userProfile?.company_id) {
          setReportData((prev) => ({
            ...prev,
            loaded: true,
            error: profileError?.message || 'Your user profile has no company_id.',
          }));
          setIsRefreshing(false);
          return;
        }

        setProfile(userProfile as AuthProfile);

        const normalizedRole = normalizeRole((userProfile as any).role);
        const isAgent = normalizedRole === 'agent';
        const collectorScope = normalizeText((userProfile as any).name);

        const [accounts, payments, ptps] = await Promise.all([
          fetchAllRows('accounts', {
            companyId: String((userProfile as any).company_id),
            collectorName: collectorScope,
            restrictToCollector: isAgent,
          }),
          fetchAllRows('payments', {
            companyId: String((userProfile as any).company_id),
            collectorName: collectorScope,
            restrictToCollector: isAgent,
          }),
          fetchAllRows('ptps', {
            companyId: String((userProfile as any).company_id),
            collectorName: collectorScope,
            restrictToCollector: isAgent,
          }),
        ]);

        if (!mounted) return;

        setReportData({
          accounts,
          payments,
          ptps,
          loaded: true,
          error: null,
        });
        setIsRefreshing(false);
        setRestoredFromCache(false);
      } catch (error: any) {
        if (!mounted) return;

        setReportData((prev) => ({
          ...prev,
          loaded: true,
          error: error?.message || 'Unknown error',
        }));
        setIsRefreshing(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [cacheHydrated]);

  const { accounts, ptps } = reportData;

  const totalBalance = accounts.reduce(
    (sum, item) => sum + Number(item.balance || 0),
    0
  );

  const totalCollected = accounts.reduce(
    (sum, item) => sum + Number(item.amount_paid || 0),
    0
  );

  const collectedThisMonth = accounts
    .filter((item) =>
      isCurrentMonth(item.last_action_date || item.updated_at || item.created_at)
    )
    .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);

  const openPtps = ptps.filter((item) => item.status === 'Promise To Pay').length;

  const keptPtps = ptps.filter((item) => item.resolution_type === 'kept').length;

  const brokenPtps = ptps.filter((item) => item.resolution_type === 'broken').length;

  const resolvedPtps = ptps.filter(
    (item) => item.resolution_type === 'kept' || item.resolution_type === 'broken'
  ).length;

  const ptpKeptRate = resolvedPtps > 0 ? (keptPtps / resolvedPtps) * 100 : 0;
  const ptpConversionRate = ptps.length > 0 ? (keptPtps / ptps.length) * 100 : 0;

  const callbackAccounts = accounts.filter(
    (item) => item.status === 'Callback Requested'
  ).length;

  const accountProducts = Array.from(
    new Set(
      accounts
        .map((item) => normalizeText(item.product || item.product_name))
        .filter(Boolean)
    )
  ).sort((a, b) => String(a).localeCompare(String(b)));

  const productRows = accountProducts.map((product) => {
    const productAccounts = accounts.filter(
      (item) => normalizeText(item.product || item.product_name) === product
    );

    return {
      product,
      accounts: productAccounts.length,
      balance: productAccounts.reduce(
        (sum, item) => sum + Number(item.balance || 0),
        0
      ),
      collected: productAccounts.reduce(
        (sum, item) => sum + Number(item.amount_paid || 0),
        0
      ),
      collectedThisMonth: productAccounts
        .filter((item) =>
          isCurrentMonth(item.last_action_date || item.updated_at || item.created_at)
        )
        .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0),
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

    const collectorCollected = collectorAccounts.reduce(
      (sum, item) => sum + Number(item.amount_paid || 0),
      0
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

    const accountsCount = collectorAccounts.length;

    return {
      collector,
      accounts: accountsCount,
      balance: collectorAccounts.reduce(
        (sum, item) => sum + Number(item.balance || 0),
        0
      ),
      collected: collectorCollected,
      collectedThisMonth: collectorAccounts
        .filter((item) =>
          isCurrentMonth(item.last_action_date || item.updated_at || item.created_at)
        )
        .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0),
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
      avgCollectedPerAccount:
        accountsCount > 0 ? collectorCollected / accountsCount : 0,
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

  const earlyWarningRows = useMemo(() => {
    return accounts
      .map((account): EarlyWarningRow | null => {
        const dueDate =
          normalizeText(account.due_date) ||
          normalizeText(account.loan_due_date) ||
          normalizeText(account.next_action_date);

        const daysToRollover = daysUntil(dueDate);

        if (daysToRollover === null || daysToRollover < 1 || daysToRollover > 3) {
          return null;
        }

        const currentBucket = getBucketLabel(account.dpd);
        const nextBucket = getNextBucketLabel(currentBucket);
        const ptpStatus = getPtpStatusForAccount(String(account.id || ''), ptps);
        const disposition = getDispositionLabel(account);
        const priorityMeta = getPriorityMeta({
          account,
          daysToRollover,
          ptpStatus,
        });

        return {
          id: String(account.id || `${account.cfid || ''}-${account.account_no || ''}`),
          cfid: normalizeText(account.cfid) || '-',
          debtorName: normalizeText(account.debtor_name) || '-',
          collector: normalizeText(account.collector_name) || 'Unassigned',
          product: normalizeText(account.product || account.product_name) || '-',
          currentBucket,
          nextBucket,
          daysToRollover,
          dueDate: dueDate || '-',
          balance: Number(account.balance || 0),
          amountPaid: Number(account.amount_paid || 0),
          disposition,
          ptpStatus,
          priority: priorityMeta.priority,
          score: priorityMeta.score,
          suggestedAction: priorityMeta.suggestedAction,
          rawStatus: normalizeText(account.status) || '-',
        };
      })
      .filter((row): row is EarlyWarningRow => row !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.daysToRollover !== b.daysToRollover) return a.daysToRollover - b.daysToRollover;
        return b.balance - a.balance;
      });
  }, [accounts, ptps]);

  const filteredEarlyWarningRows = useMemo(() => {
    return earlyWarningRows.filter((row) => {
      if (priorityFilter !== 'all' && row.priority !== priorityFilter) {
        return false;
      }

      if (rolloverFilter !== 'all' && row.daysToRollover !== Number(rolloverFilter)) {
        return false;
      }

      if (collectorFilter !== 'all' && row.collector !== collectorFilter) {
        return false;
      }

      return true;
    });
  }, [earlyWarningRows, priorityFilter, rolloverFilter, collectorFilter]);

  const criticalWarningCount = earlyWarningRows.filter((row) => row.priority === 'Critical').length;
  const warningDueTomorrow = earlyWarningRows.filter((row) => row.daysToRollover === 1).length;
  const unreachableNearDue = earlyWarningRows.filter(
    (row) =>
      row.daysToRollover <= 2 &&
      row.disposition.toLowerCase().includes('unreach')
  ).length;
  const brokenPtpNearDue = earlyWarningRows.filter(
    (row) => row.daysToRollover <= 2 && row.ptpStatus === 'Broken'
  ).length;

  const computedRollRateRange = useMemo(() => {
    const now = new Date();

    if (rollRateWindow === 'current_month') {
      return {
        start: startOfMonth(now),
        end: endOfMonth(now),
      };
    }

    if (rollRateWindow === 'last_30_days') {
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const start = new Date(end);
      start.setDate(start.getDate() - 29);
      return { start, end };
    }

    const parsedStart = parseInputDate(rollRateStartDate) || startOfMonth(now);
    const parsedEnd = parseInputDate(rollRateEndDate) || endOfMonth(now);

    return clampRangeToNinetyDays(parsedStart, parsedEnd);
  }, [rollRateWindow, rollRateStartDate, rollRateEndDate]);

  const rollRateAccountsInRange = useMemo(() => {
    return accounts.filter((account) => {
      const dueDate =
        normalizeText(account.due_date) ||
        normalizeText(account.loan_due_date) ||
        normalizeText(account.next_action_date);

      const parsed = parseDateOnly(dueDate);
      if (!parsed) return false;

      return parsed >= computedRollRateRange.start && parsed <= computedRollRateRange.end;
    });
  }, [accounts, computedRollRateRange]);

  const rollRateRows = useMemo(() => {
    const grouped = new Map<string, RollRateRow>();

    for (const account of rollRateAccountsInRange) {
      const collector = normalizeText(account.collector_name) || 'Unassigned';
      const dueDate =
        normalizeText(account.due_date) ||
        normalizeText(account.loan_due_date) ||
        normalizeText(account.next_action_date);

      const week = getWeekOfMonth(dueDate);
      if (!week) continue;

      const currentBucket = getBucketLabel(account.dpd);
      const nextBucket = getNextBucketLabel(currentBucket);
      const balance = Number(account.balance || 0);
      const amountPaid = Number(account.amount_paid || 0);
      const daysToRollover = daysUntil(dueDate);

      const isAtRisk =
        daysToRollover !== null &&
        daysToRollover >= 1 &&
        daysToRollover <= 7 &&
        balance > 0;

      const key = `${collector}::${week}::${currentBucket}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          collector,
          week,
          bucket: currentBucket,
          nextBucket,
          accountsInBucket: 0,
          accountsAtRisk: 0,
          valueInBucket: 0,
          valueAtRisk: 0,
          rollRateCount: 0,
          rollRateValue: 0,
          highRiskAgent: false,
        });
      }

      const row = grouped.get(key)!;

      row.accountsInBucket += 1;
      row.valueInBucket += balance;

      if (isAtRisk) {
        row.accountsAtRisk += 1;
        row.valueAtRisk += Math.max(balance - amountPaid, 0);
      }
    }

    const rows = Array.from(grouped.values()).map((row) => {
      const rollRateCount =
        row.accountsInBucket > 0 ? (row.accountsAtRisk / row.accountsInBucket) * 100 : 0;

      const rollRateValue =
        row.valueInBucket > 0 ? (row.valueAtRisk / row.valueInBucket) * 100 : 0;

      return {
        ...row,
        rollRateCount,
        rollRateValue,
        highRiskAgent: rollRateCount >= 40 || rollRateValue >= 40,
      };
    });

    return rows.sort((a, b) => {
      const weekOrder = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
      const weekDiff = weekOrder.indexOf(a.week) - weekOrder.indexOf(b.week);
      if (weekDiff !== 0) return weekDiff;

      if (b.rollRateCount !== a.rollRateCount) return b.rollRateCount - a.rollRateCount;
      return b.valueAtRisk - a.valueAtRisk;
    });
  }, [rollRateAccountsInRange]);

  const highRiskAgentCount = new Set(
    rollRateRows.filter((row) => row.highRiskAgent).map((row) => row.collector)
  ).size;

  const totalAccountsAtRisk = rollRateRows.reduce((sum, row) => sum + row.accountsAtRisk, 0);
  const totalValueAtRisk = rollRateRows.reduce((sum, row) => sum + row.valueAtRisk, 0);

  if (!reportData.loaded && !restoredFromCache) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Reports</h1>
        <p className="text-slate-500">Loading reports...</p>
      </div>
    );
  }

  if (reportData.error && !restoredFromCache && reportData.accounts.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Reports</h1>
        <p className="text-red-600">Failed to load report data: {reportData.error}</p>
      </div>
    );
  }

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

  function handleDownloadEarlyWarningReport() {
    downloadCsv(
      'early-warning-report.csv',
      filteredEarlyWarningRows.map((row) => ({
        CFID: row.cfid,
        Debtor: row.debtorName,
        Collector: row.collector,
        Product: row.product,
        'Current Bucket': row.currentBucket,
        'Next Bucket': row.nextBucket,
        'Days To Rollover': row.daysToRollover,
        'Due Date': row.dueDate,
        Balance: row.balance,
        'Amount Paid': row.amountPaid,
        Disposition: row.disposition,
        'PTP Status': row.ptpStatus,
        Priority: row.priority,
        'Suggested Action': row.suggestedAction,
        Status: row.rawStatus,
      }))
    );
  }

  function handleDownloadRollRatesReport() {
    downloadCsv(
      'roll-rates-report.csv',
      rollRateRows.map((row) => ({
        Collector: row.collector,
        Week: row.week,
        'Current Bucket': row.bucket,
        'Next Bucket': row.nextBucket,
        'Accounts In Bucket': row.accountsInBucket,
        'Accounts At Risk': row.accountsAtRisk,
        'Value In Bucket': row.valueInBucket,
        'Value At Risk': row.valueAtRisk,
        'Roll Rate Count %': row.rollRateCount.toFixed(1),
        'Roll Rate Value %': row.rollRateValue.toFixed(1),
        'High Risk Agent': row.highRiskAgent ? 'Yes' : 'No',
      }))
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold">Reports</h1>
            {isRefreshing ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Refreshing…
              </span>
            ) : null}
          </div>

          {restoredFromCache ? (
            <p className="mt-2 text-sm text-slate-500">
              Restored your last report view while the latest data loads.
            </p>
          ) : null}

          <p className="mt-1 text-slate-500">
            Live reporting summary built from accounts, payments and PTP records.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {activeTab === 'overview' ? (
            <>
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
            </>
          ) : activeTab === 'early_warning' ? (
            <button
              onClick={handleDownloadEarlyWarningReport}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download Early Warning Report
            </button>
          ) : (
            <button
              onClick={handleDownloadRollRatesReport}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download Roll Rates Report
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            activeTab === 'overview'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Overview
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('early_warning')}
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            activeTab === 'early_warning'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Early Warning
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('roll_rates')}
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            activeTab === 'roll_rates'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Roll Rates
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
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
        </>
      ) : activeTab === 'early_warning' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <p className="text-sm text-rose-700">Critical Warnings</p>
              <p className={getKpiValueClass(String(criticalWarningCount))}>
                {criticalWarningCount}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <p className="text-sm text-amber-700">Rolling in 1 Day</p>
              <p className={getKpiValueClass(String(warningDueTomorrow))}>
                {warningDueTomorrow}
              </p>
            </div>

            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <p className="text-sm text-red-700">Unreachable Near Due</p>
              <p className={getKpiValueClass(String(unreachableNearDue))}>
                {unreachableNearDue}
              </p>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
              <p className="text-sm text-orange-700">Broken PTP Near Due</p>
              <p className={getKpiValueClass(String(brokenPtpNearDue))}>
                {brokenPtpNearDue}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Early Warning Signals</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Accounts likely to roll into the next bucket in 3, 2, or 1 day(s),
                  with priority raised for unreachable, broken PTP, and callback-risk cases.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Priority
                  </label>
                  <select
                    value={priorityFilter}
                    onChange={(e) =>
                      setPriorityFilter(e.target.value as 'all' | WarningPriority)
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All priorities</option>
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Rollover Window
                  </label>
                  <select
                    value={rolloverFilter}
                    onChange={(e) => setRolloverFilter(e.target.value as RolloverFilter)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All (1-3 days)</option>
                    <option value="3">3 days</option>
                    <option value="2">2 days</option>
                    <option value="1">1 day</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Collector
                  </label>
                  <select
                    value={collectorFilter}
                    onChange={(e) => setCollectorFilter(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="all">All collectors</option>
                    {collectors.map((collector) => (
                      <option key={collector} value={collector}>
                        {collector}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <DataTable
                headers={[
                  'Priority',
                  'CFID',
                  'Debtor',
                  'Collector',
                  'Product',
                  'Current Bucket',
                  'Next Bucket',
                  'Days to Rollover',
                  'Due Date',
                  'Balance',
                  'Amount Paid',
                  'Disposition',
                  'PTP Status',
                  'Suggested Action',
                ]}
              >
                {filteredEarlyWarningRows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                          row.priority === 'Critical'
                            ? 'bg-rose-100 text-rose-700'
                            : row.priority === 'High'
                              ? 'bg-amber-100 text-amber-700'
                              : row.priority === 'Medium'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{row.cfid}</td>
                    <td className="px-4 py-3">{row.debtorName}</td>
                    <td className="px-4 py-3">{row.collector}</td>
                    <td className="px-4 py-3">{row.product}</td>
                    <td className="px-4 py-3">{row.currentBucket}</td>
                    <td className="px-4 py-3">{row.nextBucket}</td>
                    <td className="px-4 py-3">{row.daysToRollover}</td>
                    <td className="px-4 py-3">{row.dueDate}</td>
                    <td className="px-4 py-3">{currency(row.balance)}</td>
                    <td className="px-4 py-3">{currency(row.amountPaid)}</td>
                    <td className="px-4 py-3">{row.disposition}</td>
                    <td className="px-4 py-3">{row.ptpStatus}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{row.suggestedAction}</td>
                  </tr>
                ))}
              </DataTable>

              {filteredEarlyWarningRows.length === 0 ? (
                <div className="rounded-b-2xl border-x border-b border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                  No accounts match the current early warning filters.
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <p className="text-sm text-rose-700">High Roll-Risk Agents</p>
              <p className={getKpiValueClass(String(highRiskAgentCount))}>
                {highRiskAgentCount}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <p className="text-sm text-amber-700">Accounts At Risk</p>
              <p className={getKpiValueClass(String(totalAccountsAtRisk))}>
                {totalAccountsAtRisk}
              </p>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
              <p className="text-sm text-orange-700">Value At Risk</p>
              <p className={getKpiValueClass(currency(totalValueAtRisk))}>
                {currency(totalValueAtRisk)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Weeks in View</p>
              <p
                className={getKpiValueClass(
                  String(new Set(rollRateRows.map((row) => row.week)).size)
                )}
              >
                {new Set(rollRateRows.map((row) => row.week)).size}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Roll Rates by Agent and Week</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Live weekly roll-risk view by collector, bucket and value. This version uses
                  current account state and will be followed by locked weekly snapshot logic next.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Period
                  </label>
                  <select
                    value={rollRateWindow}
                    onChange={(e) => setRollRateWindow(e.target.value as RollRateWindow)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="current_month">Current month</option>
                    <option value="last_30_days">Last 30 days</option>
                    <option value="custom">Custom range</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={rollRateStartDate}
                    onChange={(e) => setRollRateStartDate(e.target.value)}
                    disabled={rollRateWindow !== 'custom'}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:bg-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={rollRateEndDate}
                    onChange={(e) => setRollRateEndDate(e.target.value)}
                    disabled={rollRateWindow !== 'custom'}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:bg-slate-100"
                  />
                </div>
              </div>
            </div>

            {rollRateWindow === 'custom' ? (
              <p className="mt-3 text-sm text-slate-500">
                Custom range is capped to 3 months for performance and consistency.
              </p>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <DataTable
                headers={[
                  'Collector',
                  'Week',
                  'Current Bucket',
                  'Next Bucket',
                  'Accounts In Bucket',
                  'Accounts At Risk',
                  'Value In Bucket',
                  'Value At Risk',
                  'Roll Rate Count %',
                  'Roll Rate Value %',
                  'Risk Flag',
                ]}
              >
                {rollRateRows.map((row, index) => (
                  <tr key={`${row.collector}-${row.week}-${row.bucket}-${index}`}>
                    <td className="px-4 py-3 font-medium">{row.collector}</td>
                    <td className="px-4 py-3">{row.week}</td>
                    <td className="px-4 py-3">{row.bucket}</td>
                    <td className="px-4 py-3">{row.nextBucket}</td>
                    <td className="px-4 py-3">{row.accountsInBucket}</td>
                    <td className="px-4 py-3">{row.accountsAtRisk}</td>
                    <td className="px-4 py-3">{currency(row.valueInBucket)}</td>
                    <td className="px-4 py-3">{currency(row.valueAtRisk)}</td>
                    <td className="px-4 py-3">{formatPercent(row.rollRateCount)}</td>
                    <td className="px-4 py-3">{formatPercent(row.rollRateValue)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                          row.highRiskAgent
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {row.highRiskAgent ? 'High Risk' : 'Watch'}
                      </span>
                    </td>
                  </tr>
                ))}
              </DataTable>

              {rollRateRows.length === 0 ? (
                <div className="rounded-b-2xl border-x border-b border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                  No roll-rate rows match the selected period.
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}