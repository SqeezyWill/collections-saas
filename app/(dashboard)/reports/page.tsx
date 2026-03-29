'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency } from '@/lib/utils';

const PAGE_SIZE = 1000;
const COLLECTOR_PAGE_SIZE = 15;
const REPORTS_CACHE_PREFIX = 'reports-cache:v3:';

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

type ActiveTab = 'overview' | 'early_warning' | 'roll_rates' | 'conversion_rates';
type WarningPriority = 'Critical' | 'High' | 'Medium' | 'Low';
type RolloverFilter = 'all' | '3' | '2' | '1';
type PeriodWindow = 'current_month' | 'last_30_days' | 'custom';
type RollRateWeek = 'Week 1' | 'Week 2' | 'Week 3' | 'Week 4' | 'Week 5';

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

type RollRateAgentRow = {
  collector: string;
  accountsHeld: number;
  portfolioValue: number;
  week1Count: number;
  week1Value: number;
  week2Count: number;
  week2Value: number;
  week3Count: number;
  week3Value: number;
  week4Count: number;
  week4Value: number;
  week5Count: number;
  week5Value: number;
  totalAtRiskCount: number;
  totalAtRiskValue: number;
  countRate: number;
  valueRate: number;
  highRiskAgent: boolean;
};

type ConversionRow = {
  collector: string;
  totalAccountsHeld: number;
  convertedAccounts: number;
  unconvertedAccounts: number;
  totalBalanceHeld: number;
  convertedValue: number;
  unconvertedValue: number;
  countConversionRate: number;
  valueConversionRate: number;
  highPriorityFollowup: boolean;
};

type DrilldownRow = {
  id: string;
  cfid: string;
  debtorName: string;
  collector: string;
  product: string;
  bucket: string;
  dueDate: string;
  balance: number;
  amountPaid: number;
  status: string;
  actionLabel: string;
  href: string;
};

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function normalizeText(value: unknown) {
  return String(value || '').trim();
}

function normalizeCollectorName(value: unknown) {
  return normalizeText(value) || 'Unassigned';
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

function parseDateOnly(value: string | null | undefined) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
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

function monthKeyFromDate(value: string | null | undefined) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
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

async function downloadProtectedCsv(url: string, filename: string) {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error('Unable to load authenticated session for download.');
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!response.ok) {
    let message = 'Download failed.';
    try {
      const payload = await response.json();
      message = payload?.error || message;
    } catch {
      // ignore json parse issues
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(objectUrl);
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

    const existingTime = new Date(existing.created_at || existing.updated_at || 0).getTime();
    const currentTime = new Date(row.created_at || row.updated_at || 0).getTime();

    if (currentTime >= existingTime) {
      byKey.set(key, row);
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const at = new Date(a.created_at || a.updated_at || 0).getTime();
    const bt = new Date(b.created_at || b.updated_at || 0).getTime();
    return bt - at;
  });
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
  return normalizeText(latest.effectiveStatus || latest.status) || 'PTP Logged';
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
    let query: any;

    if (table === 'accounts') {
      query = supabase
        .from('accounts')
        .select(
          'id,cfid,debtor_name,account_no,balance,amount_paid,status,collector_name,product,due_date,loan_due_date,next_action_date,last_action_date,dpd,contactability,reachability,created_at,updated_at'
        )
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(from, to);
    } else if (table === 'payments') {
      query = supabase
        .from('payments')
        .select('id,account_id,amount,paid_on,collector_name,created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(from, to);
    } else {
      query = supabase
        .from('ptps')
        .select(
          'id,account_id,collector_name,promised_amount,promised_date,kept_amount,status,created_at,updated_at,is_rebooked'
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

function buildAccountHref(input: {
  product?: string;
  collector?: string;
  dueStart?: string;
  dueEnd?: string;
  paid?: 'yes' | 'no';
}) {
  const params = new URLSearchParams();

  if (input.product) params.set('product', input.product);
  if (input.collector) params.set('collector', input.collector);
  if (input.dueStart) params.set('due_start', input.dueStart);
  if (input.dueEnd) params.set('due_end', input.dueEnd);
  if (input.paid) params.set('paid', input.paid);

  const query = params.toString();
  return query ? `/accounts?${query}` : '/accounts';
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
  const [periodWindow, setPeriodWindow] = useState<PeriodWindow>('current_month');
  const [periodStartDate, setPeriodStartDate] = useState(
    toDateInputValue(startOfMonth(new Date()))
  );
  const [periodEndDate, setPeriodEndDate] = useState(
    toDateInputValue(endOfMonth(new Date()))
  );
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [drilldownTitle, setDrilldownTitle] = useState('');
  const [drilldownRows, setDrilldownRows] = useState<DrilldownRow[]>([]);
  const drilldownRef = useRef<HTMLDivElement | null>(null);

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
      if (parsed?.periodWindow) setPeriodWindow(parsed.periodWindow);
      if (parsed?.periodStartDate) setPeriodStartDate(parsed.periodStartDate);
      if (parsed?.periodEndDate) setPeriodEndDate(parsed.periodEndDate);
      if (Array.isArray(parsed?.selectedProducts)) setSelectedProducts(parsed.selectedProducts);

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

    if (requestedTab === 'conversion_rates') {
      setActiveTab('conversion_rates');
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
          periodWindow,
          periodStartDate,
          periodEndDate,
          selectedProducts,
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
    periodWindow,
    periodStartDate,
    periodEndDate,
    selectedProducts,
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

if (profileError || !userProfile?.id) {
  setReportData((prev) => ({
    ...prev,
    loaded: true,
    error: profileError?.message || 'Unable to load user profile.',
  }));
  setIsRefreshing(false);
  return;
}

let resolvedCompanyId = String(userProfile.company_id || '').trim();

if (!resolvedCompanyId) {
  const { data: fixedCompany, error: fixedCompanyError } = await supabase
    .from('companies')
    .select('id,name,code')
    .or('name.eq.Pezesha,code.eq.Pezesha')
    .limit(1)
    .maybeSingle();

  if (!mounted) return;

  if (fixedCompanyError || !fixedCompany?.id) {
    setReportData((prev) => ({
      ...prev,
      loaded: true,
      error: fixedCompanyError?.message || 'Unable to resolve Pezesha company.',
    }));
    setIsRefreshing(false);
    return;
  }

  resolvedCompanyId = String(fixedCompany.id);
}

setProfile({
  ...(userProfile as AuthProfile),
  company_id: resolvedCompanyId,
});

const normalizedRole = normalizeRole((userProfile as any).role);
const isAgent = normalizedRole === 'agent';
const collectorScope = normalizeText((userProfile as any).name);

const [accounts, payments, ptps] = await Promise.all([
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

  useEffect(() => {
    if (drilldownRows.length > 0 && drilldownRef.current) {
      drilldownRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [drilldownRows]);

  useEffect(() => {
    setCollectorPage(1);
  }, [activeTab]);

  const { accounts, payments, ptps } = reportData;

  const paymentsByAccountId = useMemo(() => {
    const map = new Map<string, Array<{ amount: number | null; paid_on: string | null }>>();

    for (const payment of payments) {
      const key = String(payment.account_id || '');
      if (!key) continue;

      const current = map.get(key) || [];
      current.push({
        amount: payment.amount ?? null,
        paid_on: payment.paid_on ?? null,
      });
      map.set(key, current);
    }

    return map;
  }, [payments]);

  const normalizedPtps = useMemo(() => {
    const deduped = dedupeOperationalRows(ptps);

    return deduped.map((ptp) => {
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
  }, [ptps, paymentsByAccountId]);

  const accountProducts = useMemo(
    () =>
      Array.from(
        new Set(accounts.map((item) => normalizeText(item.product)).filter(Boolean))
      ).sort((a, b) => String(a).localeCompare(String(b))),
    [accounts]
  );

  const selectedProductSet = useMemo(() => {
    if (selectedProducts.length === 0) {
      return new Set(accountProducts);
    }
    return new Set(selectedProducts);
  }, [selectedProducts, accountProducts]);

  const filteredAccountsByProduct = useMemo(() => {
    if (
      activeTab !== 'early_warning' &&
      activeTab !== 'roll_rates' &&
      activeTab !== 'conversion_rates'
    ) {
      return [];
    }

    return accounts.filter((item) => selectedProductSet.has(normalizeText(item.product)));
  }, [accounts, selectedProductSet, activeTab]);

  const overviewData = useMemo(() => {
    if (activeTab !== 'overview') {
      return {
        totalBalance: 0,
        totalCollected: 0,
        collectedThisMonth: 0,
        openPtps: 0,
        keptPtps: 0,
        brokenPtps: 0,
        resolvedPtps: 0,
        ptpKeptRate: 0,
        ptpConversionRate: 0,
        callbackAccounts: 0,
        productRows: [] as Array<{
          product: string;
          accounts: number;
          balance: number;
          collected: number;
          collectedThisMonth: number;
        }>,
        statusRows: [] as Array<{ status: string; count: number; balance: number }>,
        collectorRows: [] as Array<{
          collector: string;
          accounts: number;
          balance: number;
          collected: number;
          collectedThisMonth: number;
          openPtps: number;
          keptPtps: number;
          brokenPtps: number;
          ptpKeptRate: string;
          callbacks: number;
          avgCollectedPerAccount: number;
        }>,
      };
    }

    const totalBalance = accounts.reduce((sum, item) => sum + Number(item.balance || 0), 0);

    const totalCollected = accounts.reduce(
      (sum, item) => sum + Number(item.amount_paid || 0),
      0
    );

    const collectedThisMonth = accounts
      .filter((item) =>
        isCurrentMonth(item.last_action_date || item.updated_at || item.created_at)
      )
      .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);

    const openPtps = normalizedPtps.filter((item) => item.effectiveStatus === 'Promise To Pay').length;
    const keptPtps = normalizedPtps.filter((item) => item.effectiveStatus === 'Kept').length;
    const brokenPtps = normalizedPtps.filter((item) => item.effectiveStatus === 'Broken').length;

    const resolvedPtps = normalizedPtps.filter(
      (item) => item.effectiveStatus === 'Kept' || item.effectiveStatus === 'Broken'
    ).length;

    const ptpKeptRate = resolvedPtps > 0 ? (keptPtps / resolvedPtps) * 100 : 0;
    const ptpConversionRate =
      normalizedPtps.length > 0 ? (keptPtps / normalizedPtps.length) * 100 : 0;

    const callbackAccounts = accounts.filter(
      (item) => item.status === 'Callback Requested'
    ).length;

    const productRows = accountProducts.map((product) => {
      const productAccounts = accounts.filter((item) => normalizeText(item.product) === product);

      return {
        product,
        accounts: productAccounts.length,
        balance: productAccounts.reduce((sum, item) => sum + Number(item.balance || 0), 0),
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
      new Set(accounts.map((item) => normalizeCollectorName(item.collector_name)).filter(Boolean))
    ).sort((a, b) => String(a).localeCompare(String(b)));

    const collectorRows = collectors.map((collector) => {
      const collectorAccounts = accounts.filter(
        (item) => normalizeCollectorName(item.collector_name) === collector
      );

      const collectorCollected = collectorAccounts.reduce(
        (sum, item) => sum + Number(item.amount_paid || 0),
        0
      );

      const collectorPtps = normalizedPtps.filter(
        (item) => normalizeCollectorName(item.collector_name) === collector
      );

      const collectorKeptPtps = collectorPtps.filter(
        (item) => item.effectiveStatus === 'Kept'
      ).length;

      const collectorBrokenPtps = collectorPtps.filter(
        (item) => item.effectiveStatus === 'Broken'
      ).length;

      const collectorResolvedPtps = collectorPtps.filter(
        (item) => item.effectiveStatus === 'Kept' || item.effectiveStatus === 'Broken'
      ).length;

      const accountsCount = collectorAccounts.length;

      return {
        collector,
        accounts: accountsCount,
        balance: collectorAccounts.reduce((sum, item) => sum + Number(item.balance || 0), 0),
        collected: collectorCollected,
        collectedThisMonth: collectorAccounts
          .filter((item) =>
            isCurrentMonth(item.last_action_date || item.updated_at || item.created_at)
          )
          .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0),
        openPtps: collectorPtps.filter((item) => item.effectiveStatus === 'Promise To Pay').length,
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

    return {
      totalBalance,
      totalCollected,
      collectedThisMonth,
      openPtps,
      keptPtps,
      brokenPtps,
      resolvedPtps,
      ptpKeptRate,
      ptpConversionRate,
      callbackAccounts,
      productRows,
      statusRows,
      collectorRows,
    };
  }, [activeTab, accounts, normalizedPtps, accountProducts]);

  const totalCollectorPages = useMemo(
    () => Math.max(1, Math.ceil(overviewData.collectorRows.length / COLLECTOR_PAGE_SIZE)),
    [overviewData.collectorRows.length]
  );

  const pagedCollectorRows = useMemo(
    () =>
      overviewData.collectorRows.slice(
        (collectorPage - 1) * COLLECTOR_PAGE_SIZE,
        collectorPage * COLLECTOR_PAGE_SIZE
      ),
    [overviewData.collectorRows, collectorPage]
  );

  useEffect(() => {
    setCollectorPage(1);
  }, [overviewData.collectorRows.length]);

  const earlyWarningData = useMemo(() => {
    if (activeTab !== 'early_warning') {
      return {
        rows: [] as EarlyWarningRow[],
        criticalWarningCount: 0,
        warningDueTomorrow: 0,
        unreachableNearDue: 0,
        brokenPtpNearDue: 0,
      };
    }

    const earlyWarningRows = accounts
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
        const ptpStatus = getPtpStatusForAccount(String(account.id || ''), normalizedPtps);
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
          collector: normalizeCollectorName(account.collector_name),
          product: normalizeText(account.product) || '-',
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

    const filteredRows = earlyWarningRows.filter((row) => {
      if (priorityFilter !== 'all' && row.priority !== priorityFilter) return false;
      if (rolloverFilter !== 'all' && row.daysToRollover !== Number(rolloverFilter)) return false;
      if (collectorFilter !== 'all' && row.collector !== collectorFilter) return false;
      if (!selectedProductSet.has(row.product)) return false;
      return true;
    });

    return {
      rows: filteredRows,
      criticalWarningCount: filteredRows.filter((row) => row.priority === 'Critical').length,
      warningDueTomorrow: filteredRows.filter((row) => row.daysToRollover === 1).length,
      unreachableNearDue: filteredRows.filter(
        (row) => row.daysToRollover <= 2 && row.disposition.toLowerCase().includes('unreach')
      ).length,
      brokenPtpNearDue: filteredRows.filter(
        (row) => row.daysToRollover <= 2 && row.ptpStatus === 'Broken'
      ).length,
    };
  }, [
    activeTab,
    accounts,
    normalizedPtps,
    priorityFilter,
    rolloverFilter,
    collectorFilter,
    selectedProductSet,
  ]);

  const rollRatesData = useMemo(() => {
    if (activeTab !== 'roll_rates') {
      return {
        rollRateProductRows: [] as Array<{
          product: string;
          accountsAtRisk: number;
          valueAtRisk: number;
          rows: any[];
        }>,
        rollRateAgentRows: [] as RollRateAgentRow[],
        rollRateAccountsInRange: [] as any[],
        highRiskAgentCount: 0,
        totalAccountsAtRisk: 0,
        totalValueAtRisk: 0,
      };
    }

    const now = new Date();
    const computedRange =
      periodWindow === 'current_month'
        ? { start: startOfMonth(now), end: endOfMonth(now) }
        : periodWindow === 'last_30_days'
          ? (() => {
              const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const start = new Date(end);
              start.setDate(start.getDate() - 29);
              return { start, end };
            })()
          : (() => {
              const parsedStart = parseInputDate(periodStartDate) || startOfMonth(now);
              const parsedEnd = parseInputDate(periodEndDate) || endOfMonth(now);
              return clampRangeToNinetyDays(parsedStart, parsedEnd);
            })();

    const rollRateAccountsInRange = filteredAccountsByProduct.filter((account) => {
      const dueDate =
        normalizeText(account.due_date) ||
        normalizeText(account.loan_due_date) ||
        normalizeText(account.next_action_date);

      const parsed = parseDateOnly(dueDate);
      if (!parsed) return false;

      return parsed >= computedRange.start && parsed <= computedRange.end;
    });

    const products = Array.from(selectedProductSet).sort((a, b) => a.localeCompare(b));

    const rollRateProductRows = products.map((product) => {
      const rows = rollRateAccountsInRange.filter(
        (account) => normalizeText(account.product) === product
      );

      const atRisk = rows.filter(
        (account) => Number(account.balance || 0) > Number(account.amount_paid || 0)
      );

      return {
        product,
        accountsAtRisk: atRisk.length,
        valueAtRisk: atRisk.reduce(
          (sum, item) =>
            sum + Math.max(Number(item.balance || 0) - Number(item.amount_paid || 0), 0),
          0
        ),
        rows: atRisk,
      };
    });

    const grouped = new Map<string, RollRateAgentRow>();

    for (const account of rollRateAccountsInRange) {
      const collector = normalizeCollectorName(account.collector_name);
      const week = getWeekOfMonth(
        normalizeText(account.due_date) ||
          normalizeText(account.loan_due_date) ||
          normalizeText(account.next_action_date)
      );
      if (!week) continue;

      const balance = Number(account.balance || 0);
      const outstanding = Math.max(balance - Number(account.amount_paid || 0), 0);
      const isAtRisk = outstanding > 0;

      if (!grouped.has(collector)) {
        grouped.set(collector, {
          collector,
          accountsHeld: 0,
          portfolioValue: 0,
          week1Count: 0,
          week1Value: 0,
          week2Count: 0,
          week2Value: 0,
          week3Count: 0,
          week3Value: 0,
          week4Count: 0,
          week4Value: 0,
          week5Count: 0,
          week5Value: 0,
          totalAtRiskCount: 0,
          totalAtRiskValue: 0,
          countRate: 0,
          valueRate: 0,
          highRiskAgent: false,
        });
      }

      const row = grouped.get(collector)!;
      row.accountsHeld += 1;
      row.portfolioValue += balance;

      if (isAtRisk) {
        row.totalAtRiskCount += 1;
        row.totalAtRiskValue += outstanding;

        if (week === 'Week 1') {
          row.week1Count += 1;
          row.week1Value += outstanding;
        } else if (week === 'Week 2') {
          row.week2Count += 1;
          row.week2Value += outstanding;
        } else if (week === 'Week 3') {
          row.week3Count += 1;
          row.week3Value += outstanding;
        } else if (week === 'Week 4') {
          row.week4Count += 1;
          row.week4Value += outstanding;
        } else {
          row.week5Count += 1;
          row.week5Value += outstanding;
        }
      }
    }

    const rollRateAgentRows = Array.from(grouped.values())
      .map((row) => {
        const countRate = row.accountsHeld > 0 ? (row.totalAtRiskCount / row.accountsHeld) * 100 : 0;
        const valueRate = row.portfolioValue > 0 ? (row.totalAtRiskValue / row.portfolioValue) * 100 : 0;

        return {
          ...row,
          countRate,
          valueRate,
          highRiskAgent: countRate >= 40 || valueRate >= 40,
        };
      })
      .sort((a, b) => {
        if (b.countRate !== a.countRate) return b.countRate - a.countRate;
        return b.totalAtRiskValue - a.totalAtRiskValue;
      });

    return {
      rollRateProductRows,
      rollRateAgentRows,
      rollRateAccountsInRange,
      highRiskAgentCount: new Set(
        rollRateAgentRows.filter((row) => row.highRiskAgent).map((row) => row.collector)
      ).size,
      totalAccountsAtRisk: rollRateAgentRows.reduce((sum, row) => sum + row.totalAtRiskCount, 0),
      totalValueAtRisk: rollRateAgentRows.reduce((sum, row) => sum + row.totalAtRiskValue, 0),
    };
  }, [
    activeTab,
    filteredAccountsByProduct,
    selectedProductSet,
    periodWindow,
    periodStartDate,
    periodEndDate,
  ]);

  const conversionData = useMemo(() => {
    if (activeTab !== 'conversion_rates') {
      return {
        conversionRows: [] as ConversionRow[],
        totalConvertedAccounts: 0,
        totalConvertedValue: 0,
        overallConversionCountRate: 0,
        overallConversionValueRate: 0,
        productSummaryRows: [] as Array<{
          product: string;
          totalAccounts: number;
          totalValue: number;
          convertedAccounts: number;
          convertedValue: number;
        }>,
      };
    }

    const grouped = new Map<string, ConversionRow>();

    for (const account of filteredAccountsByProduct) {
      const collector = normalizeCollectorName(account.collector_name);
      const balance = Number(account.balance || 0);
      const amountPaid = Number(account.amount_paid || 0);
      const converted = amountPaid > 0;

      if (!grouped.has(collector)) {
        grouped.set(collector, {
          collector,
          totalAccountsHeld: 0,
          convertedAccounts: 0,
          unconvertedAccounts: 0,
          totalBalanceHeld: 0,
          convertedValue: 0,
          unconvertedValue: 0,
          countConversionRate: 0,
          valueConversionRate: 0,
          highPriorityFollowup: false,
        });
      }

      const row = grouped.get(collector)!;
      row.totalAccountsHeld += 1;
      row.totalBalanceHeld += balance;

      if (converted) {
        row.convertedAccounts += 1;
        row.convertedValue += amountPaid;
      } else {
        row.unconvertedAccounts += 1;
        row.unconvertedValue += balance;
      }
    }

    const conversionRows = Array.from(grouped.values())
      .map((row) => {
        const countConversionRate =
          row.totalAccountsHeld > 0 ? (row.convertedAccounts / row.totalAccountsHeld) * 100 : 0;

        const valueConversionRate =
          row.totalBalanceHeld > 0 ? (row.convertedValue / row.totalBalanceHeld) * 100 : 0;

        return {
          ...row,
          countConversionRate,
          valueConversionRate,
          highPriorityFollowup: row.unconvertedAccounts > 0 && countConversionRate < 30,
        };
      })
      .sort((a, b) => {
        if (b.countConversionRate !== a.countConversionRate) {
          return b.countConversionRate - a.countConversionRate;
        }
        return b.convertedValue - a.convertedValue;
      });

    const totalConvertedAccounts = conversionRows.reduce(
      (sum, row) => sum + row.convertedAccounts,
      0
    );

    const totalConvertedValue = conversionRows.reduce(
      (sum, row) => sum + row.convertedValue,
      0
    );

    const totalBalanceHeld = filteredAccountsByProduct.reduce(
      (sum, item) => sum + Number(item.balance || 0),
      0
    );

    const productSummaryRows = Array.from(selectedProductSet)
      .sort((a, b) => a.localeCompare(b))
      .map((product) => {
        const productAccounts = filteredAccountsByProduct.filter(
          (item) => normalizeText(item.product) === product
        );

        return {
          product,
          totalAccounts: productAccounts.length,
          totalValue: productAccounts.reduce((sum, item) => sum + Number(item.balance || 0), 0),
          convertedAccounts: productAccounts.filter((item) => Number(item.amount_paid || 0) > 0)
            .length,
          convertedValue: productAccounts.reduce(
            (sum, item) => sum + Number(item.amount_paid || 0),
            0
          ),
        };
      });

    return {
      conversionRows,
      totalConvertedAccounts,
      totalConvertedValue,
      overallConversionCountRate:
        filteredAccountsByProduct.length > 0
          ? (totalConvertedAccounts / filteredAccountsByProduct.length) * 100
          : 0,
      overallConversionValueRate:
        totalBalanceHeld > 0 ? (totalConvertedValue / totalBalanceHeld) * 100 : 0,
      productSummaryRows,
    };
  }, [activeTab, filteredAccountsByProduct, selectedProductSet]);

  const currentMonthKey = useMemo(() => monthKeyFromDate(new Date().toISOString()), []);
  const activePtpExportMonth = periodWindow === 'current_month' ? currentMonthKey : '';

  const ptpOverviewExportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (activePtpExportMonth) params.set('month', activePtpExportMonth);
    return `/api/ptps/report/export${params.toString() ? `?${params.toString()}` : ''}`;
  }, [activePtpExportMonth]);

  const ptpEarlyWarningExportHref = useMemo(() => {
    const params = new URLSearchParams();
    if (collectorFilter !== 'all') params.set('collector', collectorFilter);
    params.set('status', 'Broken');
    if (activePtpExportMonth) params.set('month', activePtpExportMonth);
    return `/api/ptps/report/export?${params.toString()}`;
  }, [collectorFilter, activePtpExportMonth]);

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

  function clearDrilldown() {
    setDrilldownTitle('');
    setDrilldownRows([]);
  }

  function openDrilldown(title: string, rows: any[]) {
    const mapped: DrilldownRow[] = rows.map((account) => {
      const dueDate =
        normalizeText(account.due_date) ||
        normalizeText(account.loan_due_date) ||
        normalizeText(account.next_action_date) ||
        '-';

      const product = normalizeText(account.product) || '-';
      const collector = normalizeCollectorName(account.collector_name);
      const paid = Number(account.amount_paid || 0) > 0 ? 'yes' : 'no';

      return {
        id: String(account.id || `${account.cfid || ''}-${account.account_no || ''}`),
        cfid: normalizeText(account.cfid) || '-',
        debtorName: normalizeText(account.debtor_name) || '-',
        collector,
        product,
        bucket: getBucketLabel(account.dpd),
        dueDate,
        balance: Number(account.balance || 0),
        amountPaid: Number(account.amount_paid || 0),
        status: normalizeText(account.status) || '-',
        actionLabel: 'Open Accounts',
        href: buildAccountHref({
          product,
          collector,
          dueStart: dueDate !== '-' ? dueDate : undefined,
          dueEnd: dueDate !== '-' ? dueDate : undefined,
          paid: paid as 'yes' | 'no',
        }),
      };
    });

    setDrilldownTitle(title);
    setDrilldownRows(mapped);
  }

  function toggleProduct(product: string) {
    setSelectedProducts((prev) => {
      if (prev.length === 0) {
        return accountProducts.filter((item) => item !== product);
      }

      if (prev.includes(product)) {
        const next = prev.filter((item) => item !== product);
        return next.length === 0 ? [] : next;
      }

      return [...prev, product].sort((a, b) => a.localeCompare(b));
    });
  }

  function selectAllProducts() {
    setSelectedProducts([]);
  }

  function handleDownloadCollectorReport() {
    downloadCsv(
      'collector-performance-report.csv',
      overviewData.collectorRows.map((row) => ({
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
      overviewData.productRows.map((row) => ({
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
      overviewData.statusRows.map((row) => ({
        Status: row.status,
        Accounts: row.count,
        Balance: row.balance,
      }))
    );
  }

  function handleDownloadEarlyWarningReport() {
    downloadCsv(
      'early-warning-report.csv',
      earlyWarningData.rows.map((row) => ({
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
      rollRatesData.rollRateAgentRows.map((row) => ({
        Collector: row.collector,
        'Accounts Held': row.accountsHeld,
        'Portfolio Value': row.portfolioValue,
        'Week 1 Count': row.week1Count,
        'Week 1 Value': row.week1Value,
        'Week 2 Count': row.week2Count,
        'Week 2 Value': row.week2Value,
        'Week 3 Count': row.week3Count,
        'Week 3 Value': row.week3Value,
        'Week 4 Count': row.week4Count,
        'Week 4 Value': row.week4Value,
        'Week 5 Count': row.week5Count,
        'Week 5 Value': row.week5Value,
        'Total At Risk Count': row.totalAtRiskCount,
        'Total At Risk Value': row.totalAtRiskValue,
        'Count Rate %': row.countRate.toFixed(1),
        'Value Rate %': row.valueRate.toFixed(1),
        'High Risk Agent': row.highRiskAgent ? 'Yes' : 'No',
      }))
    );
  }

  function handleDownloadConversionReport() {
    downloadCsv(
      'conversion-rates-report.csv',
      conversionData.conversionRows.map((row) => ({
        Collector: row.collector,
        'Accounts Held': row.totalAccountsHeld,
        'Converted Accounts': row.convertedAccounts,
        'Unconverted Accounts': row.unconvertedAccounts,
        'Count Conversion Rate %': row.countConversionRate.toFixed(1),
        'Total Balance Held': row.totalBalanceHeld,
        'Converted Value': row.convertedValue,
        'Unconverted Value': row.unconvertedValue,
        'Value Conversion Rate %': row.valueConversionRate.toFixed(1),
        'High Priority Followup': row.highPriorityFollowup ? 'Yes' : 'No',
      }))
    );
  }

  async function handleDownloadProtectedPtpExport() {
    try {
      const filename =
        activePtpExportMonth
          ? `ptp-performance-report_${activePtpExportMonth}.csv`
          : 'ptp-performance-report.csv';

      await downloadProtectedCsv(ptpOverviewExportHref, filename);
    } catch (error: any) {
      alert(error?.message || 'Failed to download PTP export.');
    }
  }

  async function handleDownloadProtectedBrokenPtpExport() {
    try {
      const filename =
        activePtpExportMonth
          ? `broken-ptp-export_${activePtpExportMonth}.csv`
          : 'broken-ptp-export.csv';

      await downloadProtectedCsv(ptpEarlyWarningExportHref, filename);
    } catch (error: any) {
      alert(error?.message || 'Failed to download broken PTP export.');
    }
  }

  function renderProductChip(product: string) {
    const isActive = selectedProducts.length === 0 || selectedProducts.includes(product);

    return (
      <button
        key={product}
        type="button"
        onClick={() => toggleProduct(product)}
        className={`rounded-full px-3 py-2 text-sm font-medium ${
          isActive
            ? 'bg-slate-900 text-white'
            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
        }`}
      >
        {product}
      </button>
    );
  }

  function renderDrilldownSection() {
    if (drilldownRows.length === 0) return null;

    return (
      <div ref={drilldownRef} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{drilldownTitle}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Click Open Accounts to move to the accounts workspace with matching context.
            </p>
          </div>

          <button
            type="button"
            onClick={clearDrilldown}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear
          </button>
        </div>

        <DataTable
          headers={[
            'CFID',
            'Debtor',
            'Collector',
            'Product',
            'Bucket',
            'Due Date',
            'Balance',
            'Amount Paid',
            'Status',
            'Action',
          ]}
        >
          {drilldownRows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-3 font-medium">{row.cfid}</td>
              <td className="px-4 py-3">{row.debtorName}</td>
              <td className="px-4 py-3">{row.collector}</td>
              <td className="px-4 py-3">{row.product}</td>
              <td className="px-4 py-3">{row.bucket}</td>
              <td className="px-4 py-3">{row.dueDate}</td>
              <td className="px-4 py-3">{currency(row.balance)}</td>
              <td className="px-4 py-3">{currency(row.amountPaid)}</td>
              <td className="px-4 py-3">{row.status}</td>
              <td className="px-4 py-3">
                <Link
                  href={row.href}
                  className="inline-flex rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                  {row.actionLabel}
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      </div>
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
              <button
                type="button"
                onClick={handleDownloadProtectedPtpExport}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download PTP Export
              </button>
            </>
          ) : activeTab === 'early_warning' ? (
            <>
              <button
                onClick={handleDownloadEarlyWarningReport}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download Early Warning Report
              </button>
              <button
                type="button"
                onClick={handleDownloadProtectedBrokenPtpExport}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download Broken PTP Export
              </button>
            </>
          ) : activeTab === 'roll_rates' ? (
            <button
              onClick={handleDownloadRollRatesReport}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download Roll Rates Report
            </button>
          ) : (
            <button
              onClick={handleDownloadConversionReport}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download Conversion Report
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => {
            setActiveTab('overview');
            clearDrilldown();
          }}
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
          onClick={() => {
            setActiveTab('early_warning');
            clearDrilldown();
          }}
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
          onClick={() => {
            setActiveTab('roll_rates');
            clearDrilldown();
          }}
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            activeTab === 'roll_rates'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Roll Rates
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('conversion_rates');
            clearDrilldown();
          }}
          className={`rounded-xl px-4 py-3 text-sm font-medium ${
            activeTab === 'conversion_rates'
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          Conversion Rates
        </button>
      </div>

      {activeTab !== 'overview' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Product Selection</h2>
              <p className="mt-1 text-sm text-slate-500">
                Choose all products or combine multiple products to focus the report.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Period
                </label>
                <select
                  value={periodWindow}
                  onChange={(e) => setPeriodWindow(e.target.value as PeriodWindow)}
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
                  value={periodStartDate}
                  onChange={(e) => setPeriodStartDate(e.target.value)}
                  disabled={periodWindow !== 'custom'}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  End Date
                </label>
                <input
                  type="date"
                  value={periodEndDate}
                  onChange={(e) => setPeriodEndDate(e.target.value)}
                  disabled={periodWindow !== 'custom'}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:bg-slate-100"
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={selectAllProducts}
              className={`rounded-full px-3 py-2 text-sm font-medium ${
                selectedProducts.length === 0
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              All Products
            </button>
            {accountProducts.map(renderProductChip)}
          </div>

          {periodWindow === 'custom' ? (
            <p className="mt-3 text-sm text-slate-500">
              Custom range is capped to 3 months for performance and consistency.
            </p>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'overview' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-7">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Portfolio Balance</p>
              <p className={getKpiValueClass(currency(overviewData.totalBalance))}>
                {currency(overviewData.totalBalance)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Collected to Date</p>
              <p className={getKpiValueClass(currency(overviewData.totalCollected))}>
                {currency(overviewData.totalCollected)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Collected This Month</p>
              <p className={getKpiValueClass(currency(overviewData.collectedThisMonth))}>
                {currency(overviewData.collectedThisMonth)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Open PTPs</p>
              <p className={getKpiValueClass(String(overviewData.openPtps))}>
                {overviewData.openPtps}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Kept PTPs</p>
              <p className={getKpiValueClass(String(overviewData.keptPtps))}>
                {overviewData.keptPtps}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Broken PTPs</p>
              <p className={getKpiValueClass(String(overviewData.brokenPtps))}>
                {overviewData.brokenPtps}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">PTP Kept Rate</p>
              <p className={getKpiValueClass(formatPercent(overviewData.ptpKeptRate))}>
                {formatPercent(overviewData.ptpKeptRate)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Conversion: {formatPercent(overviewData.ptpConversionRate)}
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
              {overviewData.productRows.map((row) => (
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
                {overviewData.statusRows.map((row) => (
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
                  {Math.min(collectorPage * COLLECTOR_PAGE_SIZE, overviewData.collectorRows.length)} of{' '}
                  {overviewData.collectorRows.length} agents
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
                    <td className="px-4 py-3">{currency(row.avgCollectedPerAccount)}</td>
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
            <h2 className="text-lg font-semibold text-slate-900">Management Snapshot</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-sm text-slate-500">Callback Accounts</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {overviewData.callbackAccounts}
                </p>
              </div>

              <div>
                <p className="text-sm text-slate-500">Portfolio Collection Rate</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {overviewData.totalBalance + overviewData.totalCollected > 0
                    ? formatPercent(
                        (overviewData.totalCollected /
                          (overviewData.totalBalance + overviewData.totalCollected)) *
                          100
                      )
                    : '0.0%'}
                </p>
              </div>

              <div>
                <p className="text-sm text-slate-500">PTP Resolution Rate</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {overviewData.resolvedPtps > 0
                    ? formatPercent(
                        (overviewData.resolvedPtps / normalizedPtps.length) * 100
                      )
                    : '0.0%'}
                </p>
              </div>

              <div>
                <p className="text-sm text-slate-500">Collectors in Report</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {overviewData.collectorRows.length}
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
              <p className={getKpiValueClass(String(earlyWarningData.criticalWarningCount))}>
                {earlyWarningData.criticalWarningCount}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <p className="text-sm text-amber-700">Rolling in 1 Day</p>
              <p className={getKpiValueClass(String(earlyWarningData.warningDueTomorrow))}>
                {earlyWarningData.warningDueTomorrow}
              </p>
            </div>

            <div className="rounded-2xl border border-red-200 bg-red-50 p-5 shadow-sm">
              <p className="text-sm text-red-700">Unreachable Near Due</p>
              <p className={getKpiValueClass(String(earlyWarningData.unreachableNearDue))}>
                {earlyWarningData.unreachableNearDue}
              </p>
            </div>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
              <p className="text-sm text-orange-700">Broken PTP Near Due</p>
              <p className={getKpiValueClass(String(earlyWarningData.brokenPtpNearDue))}>
                {earlyWarningData.brokenPtpNearDue}
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
                    {Array.from(
                      new Set(accounts.map((item) => normalizeCollectorName(item.collector_name)).filter(Boolean))
                    )
                      .sort((a, b) => String(a).localeCompare(String(b)))
                      .map((collector) => (
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
                {earlyWarningData.rows.map((row) => (
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

              {earlyWarningData.rows.length === 0 ? (
                <div className="rounded-b-2xl border-x border-b border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                  No accounts match the current early warning filters.
                </div>
              ) : null}
            </div>
          </div>
          {renderDrilldownSection()}
        </>
      ) : activeTab === 'roll_rates' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <p className="text-sm text-rose-700">High Roll-Risk Agents</p>
              <p className={getKpiValueClass(String(rollRatesData.highRiskAgentCount))}>
                {rollRatesData.highRiskAgentCount}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                openDrilldown(
                  `All Accounts At Risk (${rollRatesData.totalAccountsAtRisk})`,
                  rollRatesData.rollRateAccountsInRange.filter(
                    (account) => Number(account.balance || 0) > Number(account.amount_paid || 0)
                  )
                )
              }
              className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-left shadow-sm"
            >
              <p className="text-sm text-amber-700">Accounts At Risk</p>
              <p className={getKpiValueClass(String(rollRatesData.totalAccountsAtRisk))}>
                {rollRatesData.totalAccountsAtRisk}
              </p>
              <p className="mt-1 text-sm text-amber-700">Click to open affected accounts</p>
            </button>

            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-5 shadow-sm">
              <p className="text-sm text-orange-700">Value At Risk</p>
              <p className={getKpiValueClass(currency(rollRatesData.totalValueAtRisk))}>
                {currency(rollRatesData.totalValueAtRisk)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Products in View</p>
              <p className={getKpiValueClass(String(Array.from(selectedProductSet).length))}>
                {Array.from(selectedProductSet).length}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Product Breakdown</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review all products or focus on one or multiple products before drilling into agents.
                </p>
              </div>
            </div>

            <DataTable headers={['Product', 'Accounts At Risk', 'Value At Risk', 'Action']}>
              {rollRatesData.rollRateProductRows.map((row) => (
                <tr key={row.product}>
                  <td className="px-4 py-3 font-medium">{row.product}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        openDrilldown(
                          `${row.product} Accounts At Risk (${row.accountsAtRisk})`,
                          row.rows
                        )
                      }
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {row.accountsAtRisk}
                    </button>
                  </td>
                  <td className="px-4 py-3">{currency(row.valueAtRisk)}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() =>
                        openDrilldown(
                          `${row.product} Accounts At Risk (${row.accountsAtRisk})`,
                          row.rows
                        )
                      }
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      View Accounts
                    </button>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Roll Rates by Agent</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Each agent appears once. Click any count to open the affected accounts below.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <DataTable
                headers={[
                  'Collector',
                  'Accounts Held',
                  'Portfolio Value',
                  'Week 1',
                  'Week 2',
                  'Week 3',
                  'Week 4',
                  'Week 5',
                  'Total At Risk',
                  'Total Value At Risk',
                  'Count Rate %',
                  'Value Rate %',
                  'Risk Flag',
                  'Action',
                ]}
              >
                {rollRatesData.rollRateAgentRows.map((row) => {
                  const collectorAccounts = rollRatesData.rollRateAccountsInRange.filter(
                    (account) => normalizeCollectorName(account.collector_name) === row.collector
                  );

                  const weekRows = (week: RollRateWeek) =>
                    collectorAccounts.filter((account) => {
                      const dueDate =
                        normalizeText(account.due_date) ||
                        normalizeText(account.loan_due_date) ||
                        normalizeText(account.next_action_date);
                      const accountWeek = getWeekOfMonth(dueDate);
                      const outstanding =
                        Math.max(Number(account.balance || 0) - Number(account.amount_paid || 0), 0);
                      return accountWeek === week && outstanding > 0;
                    });

                  const totalRows = collectorAccounts.filter(
                    (account) =>
                      Math.max(Number(account.balance || 0) - Number(account.amount_paid || 0), 0) > 0
                  );

                  return (
                    <tr key={row.collector}>
                      <td className="px-4 py-3 font-medium">{row.collector}</td>
                      <td className="px-4 py-3">{row.accountsHeld}</td>
                      <td className="px-4 py-3">{currency(row.portfolioValue)}</td>

                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown(`${row.collector} - Week 1 Accounts At Risk`, weekRows('Week 1'))}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {row.week1Count}
                        </button>
                        <div className="text-xs text-slate-500">{currency(row.week1Value)}</div>
                      </td>

                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown(`${row.collector} - Week 2 Accounts At Risk`, weekRows('Week 2'))}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {row.week2Count}
                        </button>
                        <div className="text-xs text-slate-500">{currency(row.week2Value)}</div>
                      </td>

                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown(`${row.collector} - Week 3 Accounts At Risk`, weekRows('Week 3'))}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {row.week3Count}
                        </button>
                        <div className="text-xs text-slate-500">{currency(row.week3Value)}</div>
                      </td>

                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown(`${row.collector} - Week 4 Accounts At Risk`, weekRows('Week 4'))}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {row.week4Count}
                        </button>
                        <div className="text-xs text-slate-500">{currency(row.week4Value)}</div>
                      </td>

                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown(`${row.collector} - Week 5 Accounts At Risk`, weekRows('Week 5'))}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {row.week5Count}
                        </button>
                        <div className="text-xs text-slate-500">{currency(row.week5Value)}</div>
                      </td>

                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown(`${row.collector} - Total Accounts At Risk`, totalRows)}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {row.totalAtRiskCount}
                        </button>
                      </td>

                      <td className="px-4 py-3">{currency(row.totalAtRiskValue)}</td>
                      <td className="px-4 py-3">{formatPercent(row.countRate)}</td>
                      <td className="px-4 py-3">{formatPercent(row.valueRate)}</td>
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
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown(`${row.collector} - Total Accounts At Risk`, totalRows)}
                          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                        >
                          View Accounts
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </DataTable>

              {rollRatesData.rollRateAgentRows.length === 0 ? (
                <div className="rounded-b-2xl border-x border-b border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                  No roll-rate rows match the selected period and products.
                </div>
              ) : null}
            </div>
          </div>
          {renderDrilldownSection()}
        </>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <p className="text-sm text-emerald-700">Converted Accounts</p>
              <p className={getKpiValueClass(String(conversionData.totalConvertedAccounts))}>
                {conversionData.totalConvertedAccounts}
              </p>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
              <p className="text-sm text-blue-700">Converted Value</p>
              <p className={getKpiValueClass(currency(conversionData.totalConvertedValue))}>
                {currency(conversionData.totalConvertedValue)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Count Conversion Rate</p>
              <p className={getKpiValueClass(formatPercent(conversionData.overallConversionCountRate))}>
                {formatPercent(conversionData.overallConversionCountRate)}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Value Conversion Rate</p>
              <p className={getKpiValueClass(formatPercent(conversionData.overallConversionValueRate))}>
                {formatPercent(conversionData.overallConversionValueRate)}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Product Breakdown</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Conversion by product using the same product selection applied above.
                </p>
              </div>
            </div>

            <DataTable
              headers={[
                'Product',
                'Accounts',
                'Value Held',
                'Converted Accounts',
                'Converted Value',
              ]}
            >
              {conversionData.productSummaryRows.map((row) => (
                <tr key={row.product}>
                  <td className="px-4 py-3 font-medium">{row.product}</td>
                  <td className="px-4 py-3">{row.totalAccounts}</td>
                  <td className="px-4 py-3">{currency(row.totalValue)}</td>
                  <td className="px-4 py-3">{row.convertedAccounts}</td>
                  <td className="px-4 py-3">{currency(row.convertedValue)}</td>
                </tr>
              ))}
            </DataTable>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Conversion Rate by Agent</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Click converted or unconverted counts to open the affected accounts below.
                </p>
              </div>
            </div>

            <DataTable
              headers={[
                'Collector',
                'Accounts Held',
                'Converted Accounts',
                'Unconverted Accounts',
                'Count Conversion %',
                'Value Held',
                'Converted Value',
                'Unconverted Value',
                'Value Conversion %',
                'Follow-up',
                'Action',
              ]}
            >
              {conversionData.conversionRows.map((row) => {
                const collectorAccounts = filteredAccountsByProduct.filter(
                  (account) => normalizeCollectorName(account.collector_name) === row.collector
                );
                const convertedRows = collectorAccounts.filter(
                  (account) => Number(account.amount_paid || 0) > 0
                );
                const unconvertedRows = collectorAccounts.filter(
                  (account) => Number(account.amount_paid || 0) <= 0
                );

                return (
                  <tr key={row.collector}>
                    <td className="px-4 py-3 font-medium">{row.collector}</td>
                    <td className="px-4 py-3">{row.totalAccountsHeld}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openDrilldown(`${row.collector} - Converted Accounts`, convertedRows)}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {row.convertedAccounts}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openDrilldown(`${row.collector} - Unconverted Accounts`, unconvertedRows)}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {row.unconvertedAccounts}
                      </button>
                    </td>
                    <td className="px-4 py-3">{formatPercent(row.countConversionRate)}</td>
                    <td className="px-4 py-3">{currency(row.totalBalanceHeld)}</td>
                    <td className="px-4 py-3">{currency(row.convertedValue)}</td>
                    <td className="px-4 py-3">{currency(row.unconvertedValue)}</td>
                    <td className="px-4 py-3">{formatPercent(row.valueConversionRate)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                          row.highPriorityFollowup
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {row.highPriorityFollowup ? 'Needs Follow-up' : 'Healthy'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openDrilldown(`${row.collector} - Unconverted Accounts`, unconvertedRows)}
                        className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                      >
                        View Accounts
                      </button>
                    </td>
                  </tr>
                );
              })}
            </DataTable>

            {conversionData.conversionRows.length === 0 ? (
              <div className="rounded-b-2xl border-x border-b border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                No conversion rows match the selected products.
              </div>
            ) : null}
          </div>
          {renderDrilldownSection()}
        </>
      )}
    </div>
  );
}