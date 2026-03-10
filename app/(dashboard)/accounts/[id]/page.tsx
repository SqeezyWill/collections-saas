import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

type PageProps = {
  params: Promise<{ id: string }>;
};

function compactPhones(values: Array<string | null | undefined>) {
  return values.map((v) => String(v || '').trim()).filter(Boolean);
}

function detailValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text.length > 0 ? text : '-';
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateLike(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const isoOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoOnly) {
    const year = Number(isoOnly[1]);
    const month = Number(isoOnly[2]);
    const day = Number(isoOnly[3]);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function diffInDays(from: Date, to: Date) {
  const start = startOfLocalDay(from).getTime();
  const end = startOfLocalDay(to).getTime();
  return Math.max(0, Math.floor((end - start) / 86400000));
}

function getDpdAnchorDate(account: any): Date | null {
  return (
    parseDateLike(account?.created_at) ||
    parseDateLike(account?.uploaded_at) ||
    parseDateLike(account?.outsource_date) ||
    null
  );
}

function getEffectiveDpd(account: any): number | null {
  const baseDpd = parseNumber(account?.dpd);
  if (baseDpd == null) return null;

  const anchor = getDpdAnchorDate(account);
  if (!anchor) return baseDpd;

  const today = new Date();
  const daysElapsed = diffInDays(anchor, today);

  return baseDpd + daysElapsed;
}

function getBucketLabel(dpd: number | null) {
  if (dpd == null) return 'Unknown';
  if (dpd <= 0) return 'Current';
  if (dpd >= 1 && dpd <= 30) return '1–30';
  if (dpd >= 31 && dpd <= 60) return '31–60';
  if (dpd >= 61 && dpd <= 90) return '61–90';
  if (dpd >= 91 && dpd <= 120) return '91–120';
  return '121+';
}

function DetailTable({
  rows,
}: {
  rows: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.label}
              className={index === rows.length - 1 ? '' : 'border-b border-slate-200'}
            >
              <td className="w-[42%] bg-slate-50 px-4 py-4 font-semibold text-slate-700">
                {row.label}
              </td>
              <td className="px-4 py-4 text-slate-900">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type AccountStrategyResponse = {
  assignment: null | {
    id: string;
    account_id: string;
    strategy_id: string;
    assigned_at: string | null;
    assigned_by: string | null;
    source: string | null;
    notes: string | null;
    is_active: boolean;
  };
  strategy: null | {
    id: string;
    name: string;
    description?: string | null;
    is_active: boolean;
    sort_order?: number | null;
    steps?: any[];
    created_at?: string | null;
    updated_at?: string | null;
  };
};

async function fetchAccountStrategy(accountId: string): Promise<AccountStrategyResponse | null> {
  const adminKey = process.env.ADMIN_API_KEY || '';
  if (!adminKey) return null;

  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
    const proto = h.get('x-forwarded-proto') || 'http';
    const baseUrl = `${proto}://${host}`;

    const res = await fetch(
      `${baseUrl}/api/admin/account-strategy?accountId=${encodeURIComponent(accountId)}`,
      {
        headers: { 'x-admin-key': adminKey },
        cache: 'no-store',
      }
    );

    const text = await res.text();
    if (!res.ok) return null;

    try {
      return JSON.parse(text) as AccountStrategyResponse;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Account Workspace</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  async function reEvaluateStrategy() {
    'use server';

    const adminKey = process.env.ADMIN_API_KEY || '';
    if (!adminKey) {
      throw new Error('Admin API key is not configured.');
    }

    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
    const proto = h.get('x-forwarded-proto') || 'http';
    const baseUrl = `${proto}://${host}`;

    const res = await fetch(`${baseUrl}/api/admin/account-strategy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({
        accountId: id,
        source: 'auto',
        notes: 'Manual re-evaluation from account page.',
      }),
      cache: 'no-store',
    });

    const result = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(result?.error || 'Failed to re-evaluate strategy.');
    }

    redirect(`/accounts/${id}`);
  }

  const { data: account, error } = await supabase.from('accounts').select('*').eq('id', id).single();

  if (error || !account) {
    notFound();
  }

  const phones = compactPhones([
    account.primary_phone,
    account.secondary_phone,
    account.tertiary_phone,
  ]);

  const { data: ptps } = await supabase
    .from('ptps')
    .select('*')
    .eq('account_id', id)
    .order('created_at', { ascending: false })
    .limit(3);

  const { data: payments } = await supabase
    .from('payments')
    .select('*')
    .eq('account_id', id)
    .order('paid_on', { ascending: false })
    .limit(3);

  const strategyResp = await fetchAccountStrategy(id);
  const assignedStrategy = strategyResp?.strategy ?? null;
  const strategyAssignment = strategyResp?.assignment ?? null;

  const effectiveDpd = getEffectiveDpd(account);
  const bucketLabel = getBucketLabel(effectiveDpd);
  const storedDpd = parseNumber(account.dpd);
  const stepsCount = Array.isArray(assignedStrategy?.steps) ? assignedStrategy!.steps!.length : 0;

  const statusClasses =
    account.status === 'PTP'
      ? 'bg-amber-100 text-amber-700'
      : account.status === 'Paid'
      ? 'bg-emerald-100 text-emerald-700'
      : account.status === 'Escalated'
      ? 'bg-rose-100 text-rose-700'
      : 'bg-slate-100 text-slate-700';

  const basicDetails = [
    { label: 'Debtor Name', value: detailValue(account.debtor_name) },
    { label: 'Identification', value: detailValue(account.identification) },
    { label: 'Account Number', value: detailValue(account.account_no) },
    { label: 'Customer ID', value: detailValue(account.customer_id) },
    { label: 'CFID', value: detailValue(account.cfid) },
    { label: 'Collector', value: detailValue(account.collector_name) },
    {
      label: 'Phone Number(s)',
      value:
        phones.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {phones.map((phone) => (
              <span
                key={phone}
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
              >
                {phone}
              </span>
            ))}
          </div>
        ) : (
          '-'
        ),
    },
    { label: 'Primary Phone', value: detailValue(account.primary_phone) },
    { label: 'Other Contacts', value: detailValue(account.contacts) },
    { label: 'Employment Status', value: detailValue(account.employment_status) },
    { label: 'Employer Name', value: detailValue(account.employer_name) },
    {
      label: 'Employer Details',
      value: <span className="whitespace-pre-line">{detailValue(account.employer_details)}</span>,
    },
  ];

  const debtDetails = [
    { label: 'Product Name', value: detailValue(account.product) },
    { label: 'Product Category', value: detailValue(account.product_code) },
    { label: 'Balance', value: currency(Number(account.balance || 0)) },
    { label: 'Amount Paid', value: currency(Number(account.amount_paid || 0)) },
    { label: 'Status', value: detailValue(account.status) },
    { label: 'Current / Effective DPD', value: detailValue(effectiveDpd) },
    { label: 'Current Bucket', value: bucketLabel },
    { label: 'Last Pay Date', value: formatDate(account.last_pay_date) },
    { label: 'Last Payment Amount', value: currency(Number(account.last_pay_amount || 0)) },
    { label: 'Last Action Date', value: formatDate(account.last_action_date) },
    { label: 'Next Action Date', value: formatDate(account.next_action_date) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/accounts"
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Portfolio
        </Link>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">{account.debtor_name}</h1>
            <p className="mt-1 text-slate-500">
              Case hub for account actions, updates and recovery workflow.
            </p>
          </div>

          <span className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-medium ${statusClasses}`}>
            {account.status}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Balance</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {currency(Number(account.balance || 0))}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Amount Paid</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {currency(Number(account.amount_paid || 0))}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Current DPD</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{detailValue(effectiveDpd)}</p>
          <p className="mt-1 text-xs text-slate-500">Stored: {detailValue(storedDpd)}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Current Bucket</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{bucketLabel}</p>
          <p className="mt-1 text-xs text-slate-500">{detailValue(account.product_code)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/accounts/${id}/ptps/new`}
            className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Book PTP
          </Link>

          <Link
            href={`/accounts/${id}/payments/new`}
            className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Log Payment
          </Link>

          <Link
            href={`/accounts/${id}/status/update`}
            className="inline-flex min-w-[170px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Update Disposition
          </Link>

          <Link
            href={`/accounts/${id}/notes/new`}
            className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Notes History
          </Link>

          <Link
            href={`/accounts/${id}/assign`}
            className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Assign Collector
          </Link>

          <Link
            href={`/accounts/${id}/sms/new`}
            className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Send SMS
          </Link>

          <Link
            href={`/accounts/${id}/contact/update`}
            className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Update Contact Details
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Assigned Strategy</h2>
            <p className="mt-1 text-sm text-slate-500">
              The collection workflow plan currently applied to this account.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <form action={reEvaluateStrategy}>
              <button
                type="submit"
                className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Re-evaluate Strategy
              </button>
            </form>

            <Link
              href={`/accounts/${id}/strategy`}
              className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Change Strategy
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          {assignedStrategy ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{assignedStrategy.name}</span>
                <span
                  className={[
                    'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                    assignedStrategy.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700',
                  ].join(' ')}
                >
                  {assignedStrategy.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-xs text-slate-400">{assignedStrategy.id}</span>
              </div>

              {assignedStrategy.description ? (
                <p className="text-sm text-slate-600">{assignedStrategy.description}</p>
              ) : null}

              <div className="flex flex-wrap gap-4 pt-2 text-sm text-slate-600">
                <span>
                  <span className="font-medium text-slate-700">Steps:</span> {stepsCount}
                </span>
                <span>
                  <span className="font-medium text-slate-700">Assigned:</span>{' '}
                  {strategyAssignment?.assigned_at ? formatDate(strategyAssignment.assigned_at) : '-'}
                </span>
                <span>
                  <span className="font-medium text-slate-700">Source:</span>{' '}
                  {strategyAssignment?.source || '-'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-600">
              <p className="font-medium text-slate-800">No strategy assigned yet.</p>
              <p className="mt-1">
                Click <span className="font-medium">Change Strategy</span> to assign one.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Basic Details</h2>
            <Link
              href={`/accounts/${id}/contact/update`}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Edit contact & employer
            </Link>
          </div>

          <DetailTable rows={basicDetails} />
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Debt Details</h2>
          <DetailTable rows={debtDetails} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Recent PTPs</h2>
            <Link href={`/accounts/${id}/ptps/new`} className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Book PTP
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {ptps && ptps.length > 0 ? (
              ptps.map((ptp) => (
                <div key={ptp.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {currency(Number(ptp.promised_amount || 0))}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                        ptp.status === 'Kept'
                          ? 'bg-emerald-100 text-emerald-700'
                          : ptp.status === 'Broken'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {ptp.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Due: {formatDate(ptp.promised_date)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No PTPs yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Recent Payments</h2>
            <Link
              href={`/accounts/${id}/payments/new`}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Log payment
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {payments && payments.length > 0 ? (
              payments.map((payment) => (
                <div key={payment.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{currency(Number(payment.amount || 0))}</p>
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {payment.product || '-'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Paid on: {formatDate(payment.paid_on)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No payments yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}