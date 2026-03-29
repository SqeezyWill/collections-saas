import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAdminRole } from '@/lib/server-auth';

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

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
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

export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const auth = await requireAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: auth.status || 401 }
    );
  }

  const companyId = auth.user.companyId;
  if (!companyId) {
    return NextResponse.json({ error: 'User has no company scope.' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const collectorFilter = String(searchParams.get('collector') || '').trim();
  const statusFilter = String(searchParams.get('status') || '').trim();
  const monthFilter = String(searchParams.get('month') || '').trim();

  const sixMonthsAgo = monthsAgoDate(6);

  let ptpQuery = supabaseAdmin
    .from('ptps')
    .select('*')
    .eq('company_id', companyId)
    .gte('created_at', sixMonthsAgo)
    .order('created_at', { ascending: false });

  if (collectorFilter) {
    ptpQuery = ptpQuery.eq('collector_name', collectorFilter);
  }

  const { data: rows, error } = await ptpQuery;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reportRows = dedupeOperationalRows(rows ?? []);

  const accountIds = Array.from(
    new Set(reportRows.map((row) => String(row.account_id || '')).filter(Boolean))
  );

  const paymentsByAccountId = new Map<
    string,
    Array<{ amount: number | null; paid_on: string | null }>
  >();

  if (accountIds.length > 0) {
    const { data: paymentRows, error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select('account_id,amount,paid_on')
      .eq('company_id', companyId)
      .in('account_id', accountIds);

    if (paymentsError) {
      return NextResponse.json({ error: paymentsError.message }, { status: 500 });
    }

    for (const payment of paymentRows ?? []) {
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

  const normalizedRows = reportRows
    .map((row) => {
      const accountPayments = row.account_id
        ? paymentsByAccountId.get(String(row.account_id)) || []
        : [];

      let effectiveStatus = row.status || '-';
      let effectiveKeptAmount = Number(row.kept_amount || 0);

      const needsDerivedOutcome =
        row.status === 'Promise To Pay' && isPastDue(row.promised_date);

      const needsDerivedKeptAmount =
        row.status === 'Kept' && Number(row.kept_amount || 0) <= 0;

      if (needsDerivedOutcome || needsDerivedKeptAmount) {
        const derived = resolvePtpOutcomeFromPayments(row, accountPayments);

        if (needsDerivedOutcome) {
          effectiveStatus = derived.effectiveStatus;
        }

        if (row.status === 'Kept' || derived.effectiveStatus === 'Kept') {
          effectiveKeptAmount = derived.effectiveKeptAmount;
        }
      }

      return {
        ...row,
        effectiveStatus,
        effectiveKeptAmount,
        monthKey: monthKeyFromDate(row.created_at),
      };
    })
    .filter((row) => {
      if (statusFilter && row.effectiveStatus !== statusFilter) return false;
      if (monthFilter && row.monthKey !== monthFilter) return false;
      return true;
    });

  const agentMap = new Map<
    string,
    {
      collectorName: string;
      totalBooked: number;
      openPtps: number;
      keptPtps: number;
      brokenPtps: number;
      rebookedPtps: number;
      totalPromisedAmount: number;
      totalKeptAmount: number;
      keptRatePct: number;
    }
  >();

  for (const row of normalizedRows) {
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

  const agentSummaries = Array.from(agentMap.values())
    .map((row) => {
      const resolved = row.keptPtps + row.brokenPtps;
      return {
        ...row,
        keptRatePct: resolved > 0 ? Number(((row.keptPtps / resolved) * 100).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => a.collectorName.localeCompare(b.collectorName));

  const monthlyMap = new Map<
    string,
    {
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
    }
  >();

  for (const row of normalizedRows) {
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

  const monthlySummaries = Array.from(monthlyMap.values())
    .map((row) => {
      const resolved = row.keptPtps + row.brokenPtps;
      return {
        ...row,
        keptRatePct: resolved > 0 ? Number(((row.keptPtps / resolved) * 100).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

  const teamKeptPtps = normalizedRows.filter((row) => row.effectiveStatus === 'Kept').length;
  const teamBrokenPtps = normalizedRows.filter((row) => row.effectiveStatus === 'Broken').length;
  const teamResolved = teamKeptPtps + teamBrokenPtps;

  const teamSummary = {
    totalBooked: normalizedRows.length,
    openPtps: normalizedRows.filter((row) => row.effectiveStatus === 'Promise To Pay').length,
    keptPtps: teamKeptPtps,
    brokenPtps: teamBrokenPtps,
    rebookedPtps: normalizedRows.filter((row) => row.is_rebooked === true).length,
    totalPromisedAmount: normalizedRows.reduce(
      (sum, row) => sum + Number(row.promised_amount || 0),
      0
    ),
    totalKeptAmount: normalizedRows.reduce(
      (sum, row) => sum + Number(row.effectiveKeptAmount || 0),
      0
    ),
    keptRatePct: teamResolved > 0 ? Number(((teamKeptPtps / teamResolved) * 100).toFixed(2)) : 0,
  };

  const lines: string[] = [];

  lines.push('PTP Performance Report - Last 6 Months');
  lines.push('');
  if (collectorFilter) lines.push(`Collector Filter,${csvEscape(collectorFilter)}`);
  if (statusFilter) lines.push(`Status Filter,${csvEscape(statusFilter)}`);
  if (monthFilter) lines.push(`Month Filter,${csvEscape(monthFilter)}`);
  if (collectorFilter || statusFilter || monthFilter) lines.push('');

  lines.push('TEAM SUMMARY');
  lines.push(
    [
      'Booked',
      'Open',
      'Kept',
      'Broken',
      'Rebooked',
      'Promised Amount',
      'Kept Amount',
      'Kept Rate %',
    ].join(',')
  );
  lines.push(
    [
      teamSummary.totalBooked,
      teamSummary.openPtps,
      teamSummary.keptPtps,
      teamSummary.brokenPtps,
      teamSummary.rebookedPtps,
      teamSummary.totalPromisedAmount,
      teamSummary.totalKeptAmount,
      teamSummary.keptRatePct,
    ].map(csvEscape).join(',')
  );
  lines.push('');

  lines.push('BY AGENT');
  lines.push(
    [
      'Agent',
      'Booked',
      'Open',
      'Kept',
      'Broken',
      'Rebooked',
      'Promised Amount',
      'Kept Amount',
      'Kept Rate %',
    ].join(',')
  );

  for (const row of agentSummaries) {
    lines.push(
      [
        row.collectorName,
        row.totalBooked,
        row.openPtps,
        row.keptPtps,
        row.brokenPtps,
        row.rebookedPtps,
        row.totalPromisedAmount,
        row.totalKeptAmount,
        row.keptRatePct,
      ].map(csvEscape).join(',')
    );
  }

  lines.push('');
  lines.push('BY MONTH');
  lines.push(
    [
      'Month',
      'Booked',
      'Open',
      'Kept',
      'Broken',
      'Rebooked',
      'Promised Amount',
      'Kept Amount',
      'Kept Rate %',
    ].join(',')
  );

  for (const row of monthlySummaries) {
    lines.push(
      [
        row.monthLabel,
        row.totalBooked,
        row.openPtps,
        row.keptPtps,
        row.brokenPtps,
        row.rebookedPtps,
        row.totalPromisedAmount,
        row.totalKeptAmount,
        row.keptRatePct,
      ].map(csvEscape).join(',')
    );
  }

  lines.push('');
  lines.push('DETAIL ROWS');
  lines.push(
    [
      'Collector',
      'Account ID',
      'Promised Date',
      'Promised Amount',
      'Raw Status',
      'Effective Status',
      'Effective Kept Amount',
      'Rebooked',
      'Created At',
    ].join(',')
  );

  for (const row of normalizedRows) {
    lines.push(
      [
        row.collector_name || 'Unassigned',
        row.account_id || '',
        row.promised_date || '',
        Number(row.promised_amount || 0),
        row.status || '',
        row.effectiveStatus || '',
        Number(row.effectiveKeptAmount || 0),
        row.is_rebooked === true ? 'Yes' : 'No',
        row.created_at || '',
      ].map(csvEscape).join(',')
    );
  }

  const filenameParts = ['ptp-performance-report-last-6-months'];
  if (collectorFilter) filenameParts.push(`collector-${collectorFilter}`);
  if (statusFilter) filenameParts.push(`status-${statusFilter}`);
  if (monthFilter) filenameParts.push(`month-${monthFilter}`);

  const csv = lines.join('\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameParts.join('_')}.csv"`,
    },
  });
}