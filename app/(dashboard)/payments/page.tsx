import { unstable_noStore as noStore } from 'next/cache';
import { DataTable } from '@/components/DataTable';
import { getRequestUserProfile } from '@/lib/server-auth';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { currency, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

async function resolveFixedCompanyId() {
  if (!supabase) {
    throw new Error('Supabase client is not configured.');
  }

  const { data: fixedCompany, error: fixedCompanyError } = await supabase
    .from('companies')
    .select('id,name,code')
    .or('name.eq.Pezesha,code.eq.Pezesha')
    .limit(1)
    .maybeSingle();

  if (fixedCompanyError || !fixedCompany?.id) {
    throw new Error('Unable to resolve fixed Pezesha company.');
  }

  return String(fixedCompany.id);
}

export default async function PaymentsPage() {
  noStore();

  if (!supabaseAdmin) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="text-red-600">Supabase admin is not configured.</p>
      </div>
    );
  }

    let profile: Awaited<ReturnType<typeof getRequestUserProfile>> | null = null;
  let resolvedCompanyId = '';

  try {
    profile = await getRequestUserProfile();

    if ('error' in (profile as any)) {
      throw new Error((profile as any).error || 'Unable to load user session.');
    }

    resolvedCompanyId =
      String((profile as any)?.company_id || '').trim() || (await resolveFixedCompanyId());
  } catch (error: any) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="text-red-600">
          {error?.message || 'Unable to load user session.'}
        </p>
      </div>
    );
  }

  const normalizedRole = normalizeRole((profile as any)?.role);
  const isAgent = normalizedRole === 'agent';
  const collectorScope = String((profile as any)?.name || '').trim();

  let query = supabaseAdmin
    .from('payments')
    .select('*')
    .eq('company_id', resolvedCompanyId)
    .order('created_at', { ascending: false });

  if (isAgent && collectorScope) {
    query = query.eq('collector_name', collectorScope);
  }

  const { data: rows, error } = await query;

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="text-red-600">Failed to load payments: {error.message}</p>
      </div>
    );
  }

  const allTimeCollected = (rows ?? []).reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  );

  const collectedThisMonth = (rows ?? [])
    .filter((row) => isCurrentMonth(row.paid_on))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const latestPayment = rows?.[0] ?? null;

  const productSummary = Array.from(
    new Set((rows ?? []).map((item) => item.product).filter(Boolean))
  ).map((product) => {
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
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="mt-1 text-slate-500">
          Live payment log with payment-made date and system posted date visibility.
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