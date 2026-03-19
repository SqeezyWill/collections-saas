import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const ACCOUNTS_TABLE = 'accounts';
const NOTES_TABLE = 'notes';

type ParsedRow = Record<string, string>;

function toNumber(value: unknown) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value: unknown) {
  const num = toNumber(value);
  return num === null ? null : Math.trunc(num);
}

function toDate(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function cleanText(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function getPrimaryPhone(rawPhone: unknown) {
  const parts = String(rawPhone ?? '')
    .split(/[;,/]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return parts[0] || null;
}

function normalizeLoanType(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function normalizePortfolioCategory(value: unknown) {
  const loanType = String(value ?? '').trim().toUpperCase();
  if (!loanType) return null;
  return loanType === 'POCHI' ? 'POCHI' : 'Non-Pochi';
}

function normalizeStatus(row: ParsedRow) {
  return cleanText(row['loan_status']) || 'Open';
}

function normalizeStrategyProductCode() {
  return 'mobile_loan';
}

function buildUpdateNote(row: ParsedRow) {
  const lines: string[] = [];

  const feedback1 = cleanText(row['Officer Feedback 1']);
  const feedback2 = cleanText(row['Officer Feedback 2']);
  const ptpOffered = cleanText(row['PTP_offered']);
  const ptpDueDate = cleanText(row['PTP_due_date']);
  const ptpAmount = cleanText(row['PTP_amount']);
  const reachability = cleanText(row['Reachability']);
  const collectability = cleanText(row['Collectability']);

  if (feedback1) lines.push(`Officer Feedback 1: ${feedback1}`);
  if (feedback2) lines.push(`Officer Feedback 2: ${feedback2}`);
  if (ptpOffered) lines.push(`PTP Offered: ${ptpOffered}`);
  if (ptpDueDate) lines.push(`PTP Due Date: ${ptpDueDate}`);
  if (ptpAmount) lines.push(`PTP Amount: ${ptpAmount}`);
  if (reachability) lines.push(`Reachability: ${reachability}`);
  if (collectability) lines.push(`Collectability: ${collectability}`);

  const today = new Date().toISOString().slice(0, 10);
  lines.push(`Update Upload Date: ${today}`);

  return lines.join('\n').trim();
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  let body: { rows?: ParsedRow[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!rows.length) {
    return NextResponse.json({ error: 'rows array is required.' }, { status: 400 });
  }

  const filteredRows = rows.filter(
    (row) => String(row?.['loan_id'] || '').trim() !== ''
  );

  if (!filteredRows.length) {
    return NextResponse.json(
      { error: 'No valid update rows found. loan_id is required for updates.' },
      { status: 400 }
    );
  }

  const loanIds = Array.from(
    new Set(filteredRows.map((row) => String(row['loan_id'] || '').trim()).filter(Boolean))
  );

  const { data: existingAccounts, error: existingError } = await supabaseAdmin
    .from(ACCOUNTS_TABLE)
    .select('id,account_no')
    .eq('company_id', COMPANY_ID)
    .in('account_no', loanIds);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const accountByLoanId = new Map<string, { id: string; account_no: string | null }>();
  for (const account of existingAccounts ?? []) {
    const key = String(account.account_no || '').trim();
    if (key) {
      accountByLoanId.set(key, {
        id: String(account.id),
        account_no: account.account_no ?? null,
      });
    }
  }

  const updateResults: Array<Record<string, unknown>> = [];
  const notesPayload: Array<Record<string, unknown>> = [];

  let updatedCount = 0;
  let notFoundCount = 0;
  let failedCount = 0;

  for (const row of filteredRows) {
    const loanId = String(row['loan_id'] || '').trim();
    const matched = accountByLoanId.get(loanId);

    if (!matched) {
      notFoundCount += 1;
      updateResults.push({
        loan_id: loanId,
        status: 'not_found',
      });
      continue;
    }

    const updatePayload = {
      customer_id: cleanText(row['customer_id']),
      debtor_name: cleanText(row['customer_names']),
      contacts: cleanText(row['customer_phoneno']),
      primary_phone: getPrimaryPhone(row['customer_phoneno']),
      identification: cleanText(row['national_id']),
      region: cleanText(row['region']),
      status: normalizeStatus(row),
      product: normalizeLoanType(row['loan_type']),
      product_code: normalizeStrategyProductCode(),
      portfolio_category: normalizePortfolioCategory(row['loan_type']),
      score: toNumber(row['score']),
      risk_segment: cleanText(row['risk_segment']),
      installment_type: cleanText(row['installment_type']),
      funded_date: toDate(row['funded_date']),
      loan_taken_date: toDate(row['funded_date']),
      due_date: toDate(row['due_date']),
      loan_due_date: toDate(row['due_date']),
      last_installment_date: toDate(row['last_installment_date']),
      days_late_lastinstallment: toInteger(row['days_late_lastinstallment']),
      duration: toInteger(row['duration']),
      total_due: toNumber(row['total_due']),
      outsourced_amount: toNumber(row['total_due']),
      amount_paid: toNumber(row['repaid_amounts']) ?? 0,
      balance: toNumber(row['Outstanding_balance']) ?? 0,
      dpd: toInteger(row['days_late']) ?? 0,
      collector_name: cleanText(row['officer']),
      held_by: cleanText(row['officer']),
      contactability: cleanText(row['Reachability']),
      next_action_date: toDate(row['PTP_due_date']),
      last_action_date: new Date().toISOString().slice(0, 10),
    };

    const { error: updateError } = await supabaseAdmin
      .from(ACCOUNTS_TABLE)
      .update(updatePayload)
      .eq('id', matched.id)
      .eq('company_id', COMPANY_ID);

    if (updateError) {
      failedCount += 1;
      updateResults.push({
        loan_id: loanId,
        account_id: matched.id,
        status: 'failed',
        error: updateError.message,
      });
      continue;
    }

    const noteBody = buildUpdateNote(row);
    if (noteBody) {
      notesPayload.push({
        company_id: COMPANY_ID,
        account_id: matched.id,
        author_id: '11111111-1111-1111-1111-111111111111',
        created_by_name: 'System User',
        body: noteBody,
      });
    }

    updatedCount += 1;
    updateResults.push({
      loan_id: loanId,
      account_id: matched.id,
      status: 'updated',
    });
  }

  if (notesPayload.length > 0) {
    const { error: notesError } = await supabaseAdmin.from(NOTES_TABLE).insert(notesPayload);
    if (notesError) {
      return NextResponse.json({ error: notesError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    updatedCount,
    notFoundCount,
    failedCount,
    notesImportedCount: notesPayload.length,
    results: updateResults,
  });
}