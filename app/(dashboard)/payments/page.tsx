'use client';

import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function isCurrentMonth(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

export default function PaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [profile, setProfile] = useState<{
    id: string;
    name: string | null;
    role: string | null;
    company_id: string | null;
  } | null>(null);

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

        let { data: profileData, error: profileError } = await supabase
          .from('user_profiles')
          .select('id,name,role,company_id')
          .eq('id', userId)
          .maybeSingle();

        if (profileError || !profileData?.id) {
          if (mounted) {
            setErrorMessage('Unable to load user profile.');
            setLoading(false);
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
            }
            return;
          }

          resolvedCompanyId = String(fixedCompany.id);
        }

        const normalizedRole = normalizeRole(profileData.role);
        const isAgent = normalizedRole === 'agent';
        const collectorScope = String(profileData.name || '').trim();

        let query = supabase
          .from('payments')
          .select('*')
          .eq('company_id', resolvedCompanyId)
          .order('created_at', { ascending: false });

        if (isAgent && collectorScope) {
          query = query.eq('collector_name', collectorScope);
        }

        const { data: paymentRows, error } = await query;

        if (error) {
          if (mounted) {
            setErrorMessage(`Failed to load payments: ${error.message}`);
            setLoading(false);
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
          setRows(paymentRows ?? []);
          setLoading(false);
        }
      } catch (error: any) {
        if (mounted) {
          setErrorMessage(error?.message || 'Failed to load payments.');
          setLoading(false);
        }
      }
    }

    loadPayments();

    return () => {
      mounted = false;
    };
  }, []);

  const allTimeCollected = useMemo(
    () =>
      (rows ?? []).reduce(
        (sum, row) => sum + Number(row.amount || 0),
        0
      ),
    [rows]
  );

  const collectedThisMonth = useMemo(
    () =>
      (rows ?? [])
        .filter((row) => isCurrentMonth(row.paid_on))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [rows]
  );

  const latestPayment = rows?.[0] ?? null;

  const productSummary = useMemo(
    () =>
      Array.from(new Set((rows ?? []).map((item) => item.product).filter(Boolean))).map((product) => {
        const productPayments = (rows ?? []).filter((item) => item.product === product);

        return {
          product,
          total: productPayments.reduce(
            (sum, item) => sum + Number(item.amount || 0),
            0
          ),
          monthly: productPayments
            .filter((item) => isCurrentMonth(item.paid_on))
            .reduce((sum, item) => sum + Number(item.amount || 0), 0),
          count: productPayments.length,
        };
      }),
    [rows]
  );

  const isAgent = normalizeRole(profile?.role) === 'agent';

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="text-slate-500">Loading payments...</p>
      </div>
    );
  }

  if (errorMessage) {
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
        <h1 className="text-3xl font-semibold">Payments</h1>
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
          <DataTable headers={['Product', 'Payments', 'Collected', 'Collected This Month']}>
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
        {(rows ?? []).map((row) => (
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