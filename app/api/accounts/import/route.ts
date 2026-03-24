import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAdminRole } from '@/lib/server-auth';

const ASSIGN_TABLE = 'account_strategies';
const ACCOUNTS_TABLE = 'accounts';
const STRATEGIES_TABLE = 'strategies';
const MAP_TABLE = 'strategy_products';
const PRODUCTS_TABLE = 'products';
const NOTES_TABLE = 'notes';
const COMPANIES_TABLE = 'companies';
const PEZESHA_FALLBACK_NAME = 'Pezesha';

type ParsedRow = Record<string, string>;

type PreparedInsertRow = {
  row: ParsedRow;
  payload: Record<string, any>;
  duplicateStatus:
    | 'new'
    | 'duplicate_exact'
    | 'conflict_same_loan_diff_customer'
    | 'same_customer_other_facility';
  duplicateMessage: string | null;
  existingAccountId: string | null;
};

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

function padCfid(num: number) {
  return String(num).padStart(3, '0');
}

function getPrimaryPhone(rawPhone: unknown) {
  const parts = String(rawPhone ?? '')
    .split(/[;,/]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return parts[0] || null;
}

function getNumericCfid(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '').trim();
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function getBucketMeta(dpd: number | null) {
  if (dpd == null) {
    return {
      key: 'unknown',
      label: 'Unknown',
      aliases: [] as string[],
    };
  }

  if (dpd <= 0) {
    return {
      key: 'current',
      label: 'Current',
      aliases: ['current', '0', '0+', 'dpd 0', '0-0'],
    };
  }

  if (dpd >= 1 && dpd <= 30) {
    return {
      key: '1_30',
      label: '1-30',
      aliases: ['1-30', '01-30', '1 to 30', 'dpd 1-30', '1_30', '1–30'],
    };
  }

  if (dpd >= 31 && dpd <= 60) {
    return {
      key: '31_60',
      label: '31-60',
      aliases: ['31-60', '31 to 60', 'dpd 31-60', '31_60', '31–60'],
    };
  }

  if (dpd >= 61 && dpd <= 90) {
    return {
      key: '61_90',
      label: '61-90',
      aliases: ['61-90', '61 to 90', 'dpd 61-90', '61_90', '61–90'],
    };
  }

  if (dpd >= 91 && dpd <= 120) {
    return {
      key: '91_120',
      label: '91-120',
      aliases: ['91-120', '91 to 120', 'dpd 91-120', '91_120', '91–120'],
    };
  }

  return {
    key: '121_plus',
    label: '121+',
    aliases: [
      '121+',
      '121 plus',
      '120+',
      '120 plus',
      '121_and_above',
      '121 and above',
      'over 120',
    ],
  };
}

function matchesBucket(strategy: any, bucketAliases: string[]) {
  const haystack = `${normalize(strategy?.name)} ${normalize(strategy?.description)}`;
  return bucketAliases.some((alias) => haystack.includes(normalize(alias)));
}

function normalizeStatus(row: ParsedRow) {
  return cleanText(row['loan_status']) || 'Open';
}

function normalizeLoanType(value: unknown) {
  return cleanText(value);
}

function normalizePortfolioCategory(value: unknown) {
  const loanType = String(value ?? '').trim().toUpperCase();
  if (!loanType) return null;
  return loanType === 'POCHI' ? 'POCHI' : 'Non-Pochi';
}

function normalizeStrategyProductCode() {
  return 'mobile_loan';
}

function buildImportedNote(row: ParsedRow) {
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
  lines.push(`Upload Update Date: ${today}`);

  return lines.join('\n').trim();
}

async function resolveFallbackCompanyId(admin: NonNullable<typeof supabaseAdmin>) {
  const { data, error } = await admin
    .from(COMPANIES_TABLE)
    .select('id,name')
    .ilike('name', PEZESHA_FALLBACK_NAME)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Unable to resolve Pezesha company.');
  }

  const companyId = String(data?.id || '').trim() || null;
  if (!companyId) {
    throw new Error('Pezesha company record was not found.');
  }

  return companyId;
}

async function getMaxExistingCfid(
  admin: NonNullable<typeof supabaseAdmin>,
  companyId: string
) {
  const { data, error } = await admin
    .from(ACCOUNTS_TABLE)
    .select('cfid')
    .eq('company_id', companyId)
    .not('cfid', 'is', null)
    .order('cfid', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read existing CFIDs: ${error.message}`);
  }

  return getNumericCfid(data?.cfid) || 0;
}

async function resolveStrategyForAccount(
  admin: NonNullable<typeof supabaseAdmin>,
  input: {
    accountId: string;
    productCode: string | null;
    dpd: number | null;
  }
) {
  const productCode = cleanText(input.productCode)?.toLowerCase() || null;

  if (!productCode) {
    return {
      ok: false as const,
      error: 'Account has no product_code.',
    };
  }

  const { data: product, error: pErr } = await admin
    .from(PRODUCTS_TABLE)
    .select('id,code,is_active')
    .eq('code', productCode)
    .maybeSingle();

  if (pErr) {
    return { ok: false as const, error: pErr.message };
  }

  if (!product || product.is_active === false) {
    return {
      ok: false as const,
      error: `Unknown or inactive product_code: ${productCode}`,
    };
  }

  const { data: mapped, error: mErr } = await admin
    .from(MAP_TABLE)
    .select('strategy_id,is_active')
    .eq('product_id', product.id);

  if (mErr) {
    return { ok: false as const, error: mErr.message };
  }

  const mappedStrategyIds = (mapped ?? [])
    .filter((r: any) => r && r.is_active !== false)
    .map((r: any) => String(r.strategy_id));

  if (mappedStrategyIds.length === 0) {
    return {
      ok: false as const,
      error: `No strategies mapped to product_code=${productCode} yet.`,
    };
  }

  const { data: strategies, error: sErr } = await admin
    .from(STRATEGIES_TABLE)
    .select('id,name,description,is_active,sort_order,created_at')
    .in('id', mappedStrategyIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (sErr) {
    return { ok: false as const, error: sErr.message };
  }

  const activeStrategies = strategies ?? [];
  if (activeStrategies.length === 0) {
    return {
      ok: false as const,
      error: 'No active strategy found for this product.',
    };
  }

  const bucket = getBucketMeta(input.dpd);
  const bucketSpecific = activeStrategies.find((strategy: any) =>
    matchesBucket(strategy, bucket.aliases)
  );

  const chosen = bucketSpecific ?? activeStrategies[0];

  return {
    ok: true as const,
    strategyId: String(chosen.id),
    strategyName: chosen.name ?? null,
    meta: {
      productCode,
      dpd: input.dpd,
      bucket: bucket.label,
      matchedBy: bucketSpecific ? 'product_and_bucket' : 'product_fallback',
    },
  };
}

async function assignStrategyToAccount(
  admin: NonNullable<typeof supabaseAdmin>,
  input: {
    accountId: string;
    productCode: string | null;
    dpd: number | null;
  }
) {
  const resolved = await resolveStrategyForAccount(admin, input);

  if (!resolved.ok) {
    return resolved;
  }

  const { data: currentActive, error: currentErr } = await admin
    .from(ASSIGN_TABLE)
    .select('id,strategy_id,is_active')
    .eq('account_id', input.accountId)
    .eq('is_active', true)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentErr) {
    return { ok: false as const, error: currentErr.message };
  }

  if (currentActive && String(currentActive.strategy_id) === resolved.strategyId) {
    return {
      ok: true as const,
      skipped: true,
      strategyId: resolved.strategyId,
      strategyName: resolved.strategyName,
      meta: resolved.meta,
    };
  }

  const { error: offErr } = await admin
    .from(ASSIGN_TABLE)
    .update({ is_active: false })
    .eq('account_id', input.accountId)
    .eq('is_active', true);

  if (offErr) {
    return { ok: false as const, error: offErr.message };
  }

  const notes = [
    'Auto-assigned after bulk account import.',
    `product=${resolved.meta.productCode}`,
    `dpd=${resolved.meta.dpd ?? 'unknown'}`,
    `bucket=${resolved.meta.bucket}`,
    `match=${resolved.meta.matchedBy}`,
  ].join(' ');

  const { error: insErr } = await admin.from(ASSIGN_TABLE).insert({
    account_id: input.accountId,
    strategy_id: resolved.strategyId,
    source: 'auto',
    notes,
    is_active: true,
  });

  if (insErr) {
    return { ok: false as const, error: insErr.message };
  }

  return {
    ok: true as const,
    skipped: false,
    strategyId: resolved.strategyId,
    strategyName: resolved.strategyName,
    meta: resolved.meta,
  };
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const admin = supabaseAdmin;

  const auth = await requireAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: auth.status || 401 }
    );
  }

  let body: {
    rows?: ParsedRow[];
    companyId?: string | null;
    companyName?: string | null;
  } = {};

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  const requestedCompanyId = String(body.companyId || '').trim() || null;

  if (!rows.length) {
    return NextResponse.json({ error: 'rows array is required.' }, { status: 400 });
  }

  const filteredRows = rows.filter(
    (row) =>
      String(row?.['customer_names'] || '').trim() !== '' ||
      String(row?.['loan_id'] || '').trim() !== ''
  );

  if (!filteredRows.length) {
    return NextResponse.json({ error: 'No valid rows found to import.' }, { status: 400 });
  }

  let companyId = String(auth.user.companyId || '').trim() || null;

  if (!companyId && requestedCompanyId) {
    companyId = requestedCompanyId;
  }

  if (!companyId) {
    try {
      companyId = await resolveFallbackCompanyId(admin);
    } catch (error: any) {
      return NextResponse.json(
        { error: error?.message || 'User has no company scope.' },
        { status: 400 }
      );
    }
  }

  const loanIds = Array.from(
    new Set(filteredRows.map((row) => String(row['loan_id'] || '').trim()).filter(Boolean))
  );

  const customerIds = Array.from(
    new Set(filteredRows.map((row) => String(row['customer_id'] || '').trim()).filter(Boolean))
  );

  const [
    { data: existingByLoan, error: existingLoanError },
    { data: existingByCustomer, error: existingCustomerError },
  ] = await Promise.all([
    loanIds.length > 0
      ? admin
          .from(ACCOUNTS_TABLE)
          .select('id,account_no,customer_id,debtor_name,cfid')
          .eq('company_id', companyId)
          .in('account_no', loanIds)
      : Promise.resolve({ data: [], error: null } as any),
    customerIds.length > 0
      ? admin
          .from(ACCOUNTS_TABLE)
          .select('id,account_no,customer_id,debtor_name,cfid')
          .eq('company_id', companyId)
          .in('customer_id', customerIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (existingLoanError) {
    return NextResponse.json({ error: existingLoanError.message }, { status: 500 });
  }

  if (existingCustomerError) {
    return NextResponse.json({ error: existingCustomerError.message }, { status: 500 });
  }

  let maxExistingCfid = 0;

  try {
    maxExistingCfid = await getMaxExistingCfid(admin, companyId);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to read existing CFIDs.' },
      { status: 500 }
    );
  }

  const existingLoanMap = new Map<string, any>();
  for (const item of existingByLoan ?? []) {
    const key = String(item.account_no || '').trim();
    if (key) existingLoanMap.set(key, item);
  }

  const existingCustomerMap = new Map<string, any[]>();
  for (const item of existingByCustomer ?? []) {
    const key = String(item.customer_id || '').trim();
    if (!key) continue;
    const current = existingCustomerMap.get(key) || [];
    current.push(item);
    existingCustomerMap.set(key, current);
  }

  const preparedRows: PreparedInsertRow[] = [];
  const duplicateResults: Array<Record<string, unknown>> = [];

  let nextNumber = maxExistingCfid + 1;
  const pendingLoanKeys = new Set<string>();
  const pendingCustomerLoanKeys = new Set<string>();

  for (const row of filteredRows) {
    const loanId = String(row['loan_id'] || '').trim();
    const customerId = String(row['customer_id'] || '').trim();
    const compoundKey = `${loanId}::${customerId}`;

    const existingLoan = loanId ? existingLoanMap.get(loanId) : null;
    const existingCustomerFacilities = customerId ? existingCustomerMap.get(customerId) || [] : [];

    let duplicateStatus: PreparedInsertRow['duplicateStatus'] = 'new';
    let duplicateMessage: string | null = null;
    let existingAccountId: string | null = null;

    if (pendingCustomerLoanKeys.has(compoundKey)) {
      duplicateStatus = 'duplicate_exact';
      duplicateMessage = 'Duplicate row in current upload: same loan_id and customer_id.';
    } else if (loanId && pendingLoanKeys.has(loanId)) {
      duplicateStatus = 'conflict_same_loan_diff_customer';
      duplicateMessage = 'Conflict in current upload: same loan_id appears more than once.';
    } else if (existingLoan) {
      existingAccountId = String(existingLoan.id);

      if (String(existingLoan.customer_id || '').trim() === customerId) {
        duplicateStatus = 'duplicate_exact';
        duplicateMessage = 'Account already exists with the same loan_id and customer_id.';
      } else {
        duplicateStatus = 'conflict_same_loan_diff_customer';
        duplicateMessage =
          'Conflict: same loan_id already exists under a different customer_id.';
      }
    } else if (
      customerId &&
      existingCustomerFacilities.some(
        (facility) => String(facility.account_no || '').trim() !== loanId
      )
    ) {
      duplicateStatus = 'same_customer_other_facility';
      duplicateMessage =
        'Customer already has another facility in the system. New facility will still be created.';
    }

    const cfid = padCfid(nextNumber);
    nextNumber += 1;

    const loanType = normalizeLoanType(row['loan_type']);
    const portfolioCategory = normalizePortfolioCategory(row['loan_type']);
    const productCode = normalizeStrategyProductCode();

    const payload = {
      company_id: companyId,
      cfid,
      account_no: cleanText(row['loan_id']),
      customer_id: cleanText(row['customer_id']),
      debtor_name: cleanText(row['customer_names']),
      contacts: cleanText(row['customer_phoneno']),
      primary_phone: getPrimaryPhone(row['customer_phoneno']),
      identification: cleanText(row['national_id']),
      region: cleanText(row['region']),
      status: normalizeStatus(row),
      product: loanType,
      product_code: productCode,
      portfolio_category: portfolioCategory,
      score: toNumber(row['score']),
      risk_segment: cleanText(row['risk_segment']),
      installment_type: cleanText(row['installment_type']),
      funded_date: toDate(row['funded_date']),
      loan_taken_date: toDate(row['funded_date']),
      loan_due_date: toDate(row['due_date']),
      due_date: toDate(row['due_date']),
      last_installment_date: toDate(row['last_installment_date']),
      days_late_lastinstallment: toInteger(row['days_late_lastinstallment']),
      duration: toInteger(row['duration']),
      outsourced_amount: toNumber(row['total_due']),
      total_due: toNumber(row['total_due']),
      amount_paid: toNumber(row['repaid_amounts']) ?? 0,
      balance: toNumber(row['Outstanding_balance']) ?? 0,
      dpd: toInteger(row['days_late']) ?? 0,
      collector_name: cleanText(row['officer']),
      held_by: cleanText(row['officer']),
      contactability: cleanText(row['Reachability']),
      last_action_date: new Date().toISOString().slice(0, 10),
      next_action_date: toDate(row['PTP_due_date']),
      employment_status: 'UNKNOWN',
    };

    preparedRows.push({
      row,
      payload,
      duplicateStatus,
      duplicateMessage,
      existingAccountId,
    });

    duplicateResults.push({
      loan_id: loanId || null,
      customer_id: customerId || null,
      customer_names: cleanText(row['customer_names']),
      status: duplicateStatus,
      message: duplicateMessage,
      existingAccountId,
      willImport:
        duplicateStatus === 'new' || duplicateStatus === 'same_customer_other_facility',
    });

    if (loanId) pendingLoanKeys.add(loanId);
    if (loanId || customerId) pendingCustomerLoanKeys.add(compoundKey);
  }

  const rowsToInsert = preparedRows.filter(
    (item) =>
      item.duplicateStatus === 'new' || item.duplicateStatus === 'same_customer_other_facility'
  );

  const duplicateExactCount = preparedRows.filter(
    (item) => item.duplicateStatus === 'duplicate_exact'
  ).length;

  const conflictCount = preparedRows.filter(
    (item) => item.duplicateStatus === 'conflict_same_loan_diff_customer'
  ).length;

  const sameCustomerOtherFacilityCount = preparedRows.filter(
    (item) => item.duplicateStatus === 'same_customer_other_facility'
  ).length;

  if (rowsToInsert.length === 0) {
    return NextResponse.json({
      success: false,
      importedCount: 0,
      duplicateSummary: {
        duplicateExactCount,
        conflictCount,
        sameCustomerOtherFacilityCount,
      },
      duplicateResults,
      error: 'No new accounts to import. All rows are duplicates or conflicts.',
    });
  }

  const insertPayload = rowsToInsert.map((item) => item.payload);

  const { data: insertedAccounts, error: insertError } = await admin
    .from(ACCOUNTS_TABLE)
    .insert(insertPayload)
    .select('id,cfid,product_code,dpd');

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const notesPayload = (insertedAccounts ?? [])
    .map((account, index) => {
      const sourceRow = rowsToInsert[index]?.row;
      if (!sourceRow) return null;

      const body = buildImportedNote(sourceRow);
      if (!body) return null;

      return {
        company_id: companyId,
        account_id: account.id,
        author_id: '11111111-1111-1111-1111-111111111111',
        created_by_name: 'System User',
        body,
      };
    })
    .filter(Boolean);

  if (notesPayload.length > 0) {
    const { error: notesError } = await admin.from(NOTES_TABLE).insert(notesPayload);
    if (notesError) {
      return NextResponse.json({ error: notesError.message }, { status: 500 });
    }
  }

  const strategyResults: any[] = [];
  let assignedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  return NextResponse.json({
    success: true,
    importedCount: insertedAccounts?.length || 0,
    notesImportedCount: notesPayload.length,
    duplicateSummary: {
      duplicateExactCount,
      conflictCount,
      sameCustomerOtherFacilityCount,
    },
    duplicateResults,
    strategySummary: {
      assignedCount,
      skippedCount,
      failedCount,
    },
    strategyResults,
  });
}