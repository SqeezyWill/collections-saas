import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';

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

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const sixMonthsAgo = monthsAgoDate(6);

  const { data: rows, error } = await supabaseAdmin
    .from('ptps')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .gte('created_at', sixMonthsAgo)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reportRows = rows ?? [];

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

  for (const row of reportRows) {
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
    current.totalKeptAmount += Number(row.kept_amount || 0);

    if (row.status === 'Promise To Pay') current.openPtps += 1;
    if (row.status === 'Kept') current.keptPtps += 1;
    if (row.status === 'Broken') current.brokenPtps += 1;
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

  for (const row of reportRows) {
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
    current.totalKeptAmount += Number(row.kept_amount || 0);

    if (row.status === 'Promise To Pay') current.openPtps += 1;
    if (row.status === 'Kept') current.keptPtps += 1;
    if (row.status === 'Broken') current.brokenPtps += 1;
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

  const teamKeptPtps = reportRows.filter((row) => row.status === 'Kept').length;
  const teamBrokenPtps = reportRows.filter((row) => row.status === 'Broken').length;
  const teamResolved = teamKeptPtps + teamBrokenPtps;

  const teamSummary = {
    totalBooked: reportRows.length,
    openPtps: reportRows.filter((row) => row.status === 'Promise To Pay').length,
    keptPtps: teamKeptPtps,
    brokenPtps: teamBrokenPtps,
    rebookedPtps: reportRows.filter((row) => row.is_rebooked === true).length,
    totalPromisedAmount: reportRows.reduce((sum, row) => sum + Number(row.promised_amount || 0), 0),
    totalKeptAmount: reportRows.reduce((sum, row) => sum + Number(row.kept_amount || 0), 0),
    keptRatePct: teamResolved > 0 ? Number(((teamKeptPtps / teamResolved) * 100).toFixed(2)) : 0,
  };

  const lines: string[] = [];

  lines.push('PTP Performance Report - Last 6 Months');
  lines.push('');

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

  const csv = lines.join('\n');

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ptp-performance-report-last-6-months.csv"',
    },
  });
}
