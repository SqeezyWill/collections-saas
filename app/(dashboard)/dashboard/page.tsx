import Link from 'next/link';
import { KpiCard } from '@/components/KpiCard';
import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';
import { currency } from '@/lib/utils';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const PAGE_SIZE = 1000;

function isCurrentMonth(dateValue: string | null | undefined) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
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

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
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
    ptps
      .filter((ptp) => ptp.status === 'Promise To Pay' && ptp.account_id)
      .map((ptp) => ptp.account_id)
  );

  const dueTodayPtpAccountIds = new Set(
    ptps
      .filter(
        (ptp) =>
          ptp.status === 'Promise To Pay' &&
          ptp.account_id &&
          isToday(ptp.promised_date)
      )
      .map((ptp) => ptp.account_id)
  );

  const openPtps = openPtpAccountIds.size;
  const ptpsDueToday = dueTodayPtpAccountIds.size;

  const keptPtps = ptps.filter((ptp) => ptp.resolution_type === 'kept').length;
  const brokenPtps = ptps.filter((ptp) => ptp.resolution_type === 'broken').length;

  const resolvedPtps = ptps.filter(
    (ptp) => ptp.resolution_type === 'kept' || ptp.resolution_type === 'broken'
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
    ptps.length > 0 ? (keptPtps / ptps.length) * 100 : 0;

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
    const collectorPtps = ptps.filter((ptp) => ptp.collector_name === collector);

    const collectorOpenPtpAccounts = new Set(
      collectorPtps
        .filter((ptp) => ptp.status === 'Promise To Pay' && ptp.account_id)
        .map((ptp) => ptp.account_id)
    );

    const collectorKeptPtps = collectorPtps.filter(
      (ptp) => ptp.resolution_type === 'kept'
    ).length;

    const collectorBrokenPtps = collectorPtps.filter(
      (ptp) => ptp.resolution_type === 'broken'
    ).length;

    const collectorResolvedPtps = collectorPtps.filter(
      (ptp) => ptp.resolution_type === 'kept' || ptp.resolution_type === 'broken'
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