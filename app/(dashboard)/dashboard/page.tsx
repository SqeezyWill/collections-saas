import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';
import { KpiCard } from '@/components/KpiCard';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const PAGE_SIZE = 1000;

export default async function DashboardPage() {
  noStore();

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

async function fetchAllRows(table: 'accounts' | 'payments' | 'ptps') {
  if (!supabase) return [];

  let allRows: any[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('company_id', COMPANY_ID)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      throw error;
    }

    const rows = data ?? [];
    allRows = [...allRows, ...rows];

    if (rows.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return allRows;
}

export default async function DashboardPage() {
  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  let accountList: any[] = [];
  let payments: any[] = [];
  let ptps: any[] = [];

  try {
    [accountList, payments, ptps] = await Promise.all([
      fetchAllRows('accounts'),
      fetchAllRows('payments'),
      fetchAllRows('ptps'),
    ]);
  } catch (error: any) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-red-600">
          Failed to load dashboard data: {error?.message || 'Unknown error'}
        </p>
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

  const outstanding = accountList.reduce(
    (sum, item) => sum + Number(item.balance || 0),
    0
  );

  const totalCollected = payments.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );

  const collectedThisMonth = payments
    .filter((item) => isCurrentMonth(item.paid_on))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

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

  const escalatedAccounts = accountList.filter(
    (item) => item.status === 'Escalated'
  ).length;

  const paidAccounts = accountList.filter(
    (item) => item.status === 'Paid'
  ).length;

  const openAccounts = accountList.filter(
    (item) => item.status !== 'Paid'
  ).length;

  const activeCollectors = new Set(
    accountList.map((item) => item.collector_name).filter(Boolean)
  ).size;

  const totalAssignedValue = outstanding + totalCollected;
  const collectionRate =
    totalAssignedValue > 0 ? (totalCollected / totalAssignedValue) * 100 : 0;

  const ptpKeptRate =
    resolvedPtps > 0 ? (keptPtps / resolvedPtps) * 100 : 0;

  const ptpConversionRate =
    normalizedPtps.length > 0 ? (keptPtps / normalizedPtps.length) * 100 : 0;

  const collectors = Array.from(
    new Set(accountList.map((item) => item.collector_name).filter(Boolean))
  );

  const collectorPerformance = collectors.map((collector) => {
    const collectorAccounts = accountList.filter(
      (account) => account.collector_name === collector
    );
    const collectorPayments = payments.filter(
      (payment) => payment.collector_name === collector
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
      totalCollected: collectorPayments.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      openPtps: collectorOpenPtpAccounts.size,
      keptPtps: collectorKeptPtps,
      brokenPtps: collectorBrokenPtps,
      ptpKeptRate:
        collectorResolvedPtps > 0
          ? formatPercent((collectorKeptPtps / collectorResolvedPtps) * 100)
          : '0.0%',
      callbacks: collectorAccounts.filter(
        (account) => account.status === 'Callback Requested'
      ).length,
    };
  });

  const accountProducts = Array.from(
    new Set(accountList.map((item) => item.product).filter(Boolean))
  );

  const accountCoverage = accountProducts.map((product) => {
    const productAccounts = accountList.filter((item) => item.product === product);

    return {
      product,
      accounts: productAccounts.length,
      balance: productAccounts.reduce(
        (sum, item) => sum + Number(item.balance || 0),
        0
      ),
    };
  });

  const paymentCoverage = accountProducts.map((product) => {
    const productPayments = payments.filter((item) => item.product === product);

    return {
      product,
      paymentsCount: productPayments.length,
      collected: productPayments.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0
      ),
      hasPayments: productPayments.length > 0,
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
      title: 'PTPs Due Today',
      count: ptpsDueToday,
      href: '/accounts?filter=ptps-due-today',
      helper: 'Promises requiring follow-up today',
    },
    {
      title: 'Callbacks Due Today',
      count: callbacksToday.length,
      href: '/accounts?status=Callback%20Requested',
      helper: 'Accounts awaiting scheduled callbacks',
    },
    {
      title: 'Next Actions Due Today',
      count: nextActionDueToday.length,
      href: '/accounts',
      helper: 'Accounts with follow-up dates due today',
    },
    {
      title: 'Broken PTP Follow-ups',
      count: brokenPtpAccounts.length,
      href: '/ptps?filter=broken',
      helper: 'Promises that have broken and need action',
    },
    {
      title: 'Overdue Callbacks',
      count: overdueCallbacks.length,
      href: '/accounts?status=Callback%20Requested',
      helper: 'Callback actions missed and still pending',
    },
    {
      title: 'Stale Accounts',
      count: staleAccounts.length,
      href: '/accounts',
      helper: 'Accounts with no recent action in 3+ days',
    },
  ];

  const alerts = [
    {
      title: 'Broken PTPs need attention',
      count: brokenPtpAccounts.length,
      tone: brokenPtpAccounts.length > 0 ? 'red' : 'slate',
      href: '/ptps?filter=broken',
    },
    {
      title: 'Callbacks overdue',
      count: overdueCallbacks.length,
      tone: overdueCallbacks.length > 0 ? 'amber' : 'slate',
      href: '/accounts?status=Callback%20Requested',
    },
    {
      title: 'PTPs due today',
      count: ptpsDueToday,
      tone: ptpsDueToday > 0 ? 'blue' : 'slate',
      href: '/accounts?filter=ptps-due-today',
    },
    {
      title: 'Stale accounts',
      count: staleAccounts.length,
      tone: staleAccounts.length > 0 ? 'amber' : 'slate',
      href: '/accounts',
    },
  ];

  const quickViews = [
    {
      label: 'My Open PTP Accounts',
      href: '/accounts?filter=open-ptps',
      helper: 'Work all active promise accounts',
    },
    {
      label: 'PTPs Due Today',
      href: '/accounts?filter=ptps-due-today',
      helper: 'Focus on today’s due promises',
    },
    {
      label: 'Broken PTP Report',
      href: '/ptps?filter=broken',
      helper: 'Review all broken promises',
    },
    {
      label: 'Kept PTP Report',
      href: '/ptps?filter=kept',
      helper: 'Review successful promises kept',
    },
    {
      label: 'Payments Report',
      href: '/payments',
      helper: 'Track payment activity',
    },
    {
      label: 'Portfolio View',
      href: '/accounts',
      helper: 'Open the full collections portfolio',
    },
  ];

  const portfolioAnalysisGroups = [
    {
      category: 'Accounts',
      rows: [
        { metric: 'Total Accounts', value: totalAccounts.toLocaleString() },
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
      rows: [
        { metric: 'Escalated Accounts', value: escalatedAccounts.toLocaleString() },
      ],
    },
  ];

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-slate-500">
          Collections performance overview for your current tenant workspace.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          title="Portfolio Outstanding"
          value={outstanding}
          helper="Live total balance"
          money
        />
        <KpiCard
          title="Collected to Date"
          value={totalCollected}
          helper="All payments logged"
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
            title="Open PTP Accounts"
            value={openPtps}
            helper="Accounts with active promises"
          />
        </Link>

        <Link href="/accounts?filter=ptps-due-today" className="block">
          <KpiCard
            title="PTP Accounts Due Today"
            value={ptpsDueToday}
            helper="Accounts with promises due today"
          />
        </Link>

        <KpiCard
          title="Active Collectors"
          value={activeCollectors}
          helper="Collectors with assigned cases"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Today’s Work Queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Priority actions that agents and managers should focus on today.
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
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Metric
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-700">
                      Value
                    </th>
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