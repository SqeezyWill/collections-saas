'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

const PAYMENTS_CACHE_PREFIX = 'payments-page-cache:v2:';
const PEZESHA_FALLBACK_NAME = 'Pezesha';

type AuthProfile = {
  id: string;
  name: string | null;
  role: string | null;
  company_id: string | null;
};

type CachedPaymentsState = {
  profile: AuthProfile | null;
  paymentRows: any[];
  accountRows: any[];
  savedAt: number;
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

export default function PaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [paymentRows, setPaymentRows] = useState<any[]>([]);
  const [accountRows, setAccountRows] = useState<any[]>([]);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const paymentsCacheKey = useMemo(() => {
    const companyId = normalizeText(profile?.company_id) || 'pending-company';
    const role = normalizeRole(profile?.role);
    const name = normalizeText(profile?.name) || 'unknown-user';
    return `${PAYMENTS_CACHE_PREFIX}${companyId}:${role}:${name}`;
  }, [profile?.company_id, profile?.role, profile?.name]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(paymentsCacheKey);

      if (!raw) {
        setCacheHydrated(true);
        return;
      }

      const parsed = JSON.parse(raw) as CachedPaymentsState;

      if (parsed?.profile) setProfile(parsed.profile);
      if (Array.isArray(parsed?.paymentRows)) setPaymentRows(parsed.paymentRows);
      if (Array.isArray(parsed?.accountRows)) setAccountRows(parsed.accountRows);

      if (
        parsed?.profile ||
        Array.isArray(parsed?.paymentRows) ||
        Array.isArray(parsed?.accountRows)
      ) {
        setRestoredFromCache(true);
        setLoading(false);
      }
    } catch {
      // ignore cache errors
    } finally {
      setCacheHydrated(true);
    }
  }, [paymentsCacheKey]);

  useEffect(() => {
    if (!cacheHydrated) return;

    try {
      sessionStorage.setItem(
        paymentsCacheKey,
        JSON.stringify({
          profile,
          paymentRows,
          accountRows,
          savedAt: Date.now(),
        })
      );
    } catch {
      // ignore cache errors
    }
  }, [paymentsCacheKey, profile, paymentRows, accountRows, cacheHydrated]);

  useEffect(() => {
    let mounted = true;

    async function loadPayments() {
      try {
        if (!supabase) {
          if (mounted) {
            setErrorMessage('Supabase is not configured.');
            setLoading(false);
          }
          return;
        }

        const client = supabase;

        if (paymentRows.length === 0 && accountRows.length === 0) {
          setLoading(true);
        } else {
          setIsRefreshing(true);
        }

        const {
          data: { session },
          error: sessionError,
        } = await client.auth.getSession();

        if (sessionError) {
          if (mounted) {
            setErrorMessage(sessionError.message || 'Unable to load user session.');
            setLoading(false);
            setIsRefreshing(false);
          }
          return;
        }

        const userId = session?.user?.id;
        if (!userId) {
          if (mounted) {
            setErrorMessage('Unable to load user session.');
            setLoading(false);
            setIsRefreshing(false);
          }
          return;
        }

        const { data: profileData, error: profileError } = await client
          .from('user_profiles')
          .select('id,name,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (profileError || !profileData?.id) {
          if (mounted) {
            setErrorMessage('Unable to load user profile.');
            setLoading(false);
            setIsRefreshing(false);
          }
          return;
        }

        let resolvedCompanyId = String(profileData.company_id || '').trim();

        if (!resolvedCompanyId) {
          const { data: fixedCompany, error: fixedCompanyError } = await client
            .from('companies')
            .select('id,name,code')
            .or(`name.eq.${PEZESHA_FALLBACK_NAME},code.eq.${PEZESHA_FALLBACK_NAME}`)
            .limit(1)
            .maybeSingle();

          if (fixedCompanyError || !fixedCompany?.id) {
            if (mounted) {
              setErrorMessage('Unable to resolve Pezesha company.');
              setLoading(false);
              setIsRefreshing(false);
            }
            return;
          }

          resolvedCompanyId = String(fixedCompany.id);
        }

        const normalizedRole = normalizeRole(profileData.role);
        const isAgent = normalizedRole === 'agent';
        const collectorScope = String(profileData.name || '').trim();

        let paymentsQuery = client
          .from('payments')
          .select('*')
          .eq('company_id', resolvedCompanyId)
          .order('created_at', { ascending: false });

        let accountsQuery = client
          .from('accounts')
          .select('id,collector_name,product,balance,amount_paid,last_action_date,created_at')
          .eq('company_id', resolvedCompanyId)
          .order('created_at', { ascending: false });

        if (isAgent && collectorScope) {
          paymentsQuery = paymentsQuery.eq('collector_name', collectorScope);
          accountsQuery = accountsQuery.eq('collector_name', collectorScope);
        }

        const [
          { data: fetchedPaymentRows, error: paymentsError },
          { data: fetchedAccountRows, error: accountsError },
        ] = await Promise.all([paymentsQuery, accountsQuery]);

        if (paymentsError) {
          if (mounted) {
            setErrorMessage(`Failed to load payments: ${paymentsError.message}`);
            setLoading(false);
            setIsRefreshing(false);
          }
          return;
        }

        if (accountsError) {
          if (mounted) {
            setErrorMessage(`Failed to load payment summary accounts: ${accountsError.message}`);
            setLoading(false);
            setIsRefreshing(false);
          }
          return;
        }

        if (mounted) {
          setProfile({
            id: String(profileData.id),
            name: profileData.name ?? null,
            role: profileData.role ?? null,
            company_id: resolvedCompanyId,
          });
          setPaymentRows(fetchedPaymentRows ?? []);
          setAccountRows(fetchedAccountRows ?? []);
          setErrorMessage('');
          setLoading(false);
          setIsRefreshing(false);
          setRestoredFromCache(false);
        }
      } catch (error: any) {
        if (mounted) {
          setErrorMessage(error?.message || 'Failed to load payments.');
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    if (cacheHydrated) {
      loadPayments();
    }

    return () => {
      mounted = false;
    };
  }, [cacheHydrated]);

  const allTimeCollected = useMemo(
    () =>
      accountRows.reduce((sum, row) => sum + Number(row.amount_paid || 0), 0),
    [accountRows]
  );

  const collectedThisMonth = useMemo(
    () =>
      accountRows
        .filter((row) => isCurrentMonth(row.last_action_date || row.created_at))
        .reduce((sum, row) => sum + Number(row.amount_paid || 0), 0),
    [accountRows]
  );

  const latestPayment = paymentRows?.[0] ?? null;

  const productSummary = useMemo(
    () =>
      Array.from(
        new Set(accountRows.map((item) => item.product).filter(Boolean))
      ).map((product) => {
        const productAccounts = accountRows.filter((item) => item.product === product);

        return {
          product,
          total: productAccounts.reduce(
            (sum, item) => sum + Number(item.amount_paid || 0),
            0
          ),
          monthly: productAccounts
            .filter((item) => isCurrentMonth(item.last_action_date || item.created_at))
            .reduce((sum, item) => sum + Number(item.amount_paid || 0), 0),
          count: productAccounts.filter((item) => Number(item.amount_paid || 0) > 0).length,
        };
      }),
    [accountRows]
  );

  const isAgent = normalizeRole(profile?.role) === 'agent';

  if (loading && !restoredFromCache && paymentRows.length === 0 && accountRows.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="text-slate-500">Loading payments...</p>
      </div>
    );
  }

  if (errorMessage && !restoredFromCache && paymentRows.length === 0 && accountRows.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="text-red-600">{errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold">Payments</h1>
          {isRefreshing ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              Refreshing…
            </span>
          ) : null}
        </div>

        {restoredFromCache ? (
          <p className="mt-2 text-sm text-slate-500">
            Restored your last payments view while the latest data loads.
          </p>
        ) : null}

        <p className="mt-1 text-slate-500">
          {isAgent
            ? 'Live payment log for your assigned portfolio.'
            : 'Live payment log with payment-made date and system posted date visibility.'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Collected to Date</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {currency(allTimeCollected)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Collected This Month</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {currency(collectedThisMonth)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Latest Posted Payment</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">
            {latestPayment ? currency(Number(latestPayment.amount || 0)) : '-'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {latestPayment
              ? `Posted on ${formatDate(latestPayment.created_at || latestPayment.paid_on)}`
              : 'No payments yet'}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Product Summary</h2>
        <div className="mt-4">
          <DataTable headers={['Product', 'Paid Accounts', 'Collected', 'Collected This Month']}>
            {productSummary.map((row) => (
              <tr key={row.product}>
                <td className="px-4 py-3 font-medium">{row.product}</td>
                <td className="px-4 py-3">{row.count}</td>
                <td className="px-4 py-3">{currency(row.total)}</td>
                <td className="px-4 py-3">{currency(row.monthly)}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </div>

      <DataTable
        headers={[
          'Collector',
          'Product',
          'Amount',
          'Payment Made On',
          'Posted On',
          'Account ID',
        ]}
      >
        {paymentRows.map((row) => (
          <tr key={row.id}>
            <td className="px-4 py-3 font-medium">{row.collector_name || '-'}</td>
            <td className="px-4 py-3">{row.product || '-'}</td>
            <td className="px-4 py-3">{currency(Number(row.amount || 0))}</td>
            <td className="px-4 py-3">{formatDate(row.paid_on)}</td>
            <td className="px-4 py-3">{formatDate(row.created_at || row.paid_on)}</td>
            <td className="px-4 py-3">{row.account_id || '-'}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}