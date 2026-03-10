import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';

const ASSIGN_TABLE = 'account_strategies';
const ACCOUNTS_TABLE = 'accounts';
const STRATEGIES_TABLE = 'strategies';
const MAP_TABLE = 'strategy_products';
const PRODUCTS_TABLE = 'products';

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

function padCfid(num: number) {
  return String(num).padStart(3, '0');
}

function normalizeStatus(row: ParsedRow) {
  const contactStatus = String(row['CONTACT STATUS'] || '').trim();
  if (contactStatus) return contactStatus;
  return 'Open';
}

function normalizeProduct(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function normalizeProductCode(value: unknown) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw || null;
}

function getPrimaryPhone(rawContacts: unknown) {
  const parts = String(rawContacts ?? '')
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
    aliases: ['121+', '121 plus', '120+', '120 plus', '121_and_above', '121 and above', 'over 120'],
  };
}

function matchesBucket(strategy: any, bucketAliases: string[]) {
  const haystack = `${normalize(strategy?.name)} ${normalize(strategy?.description)}`;
  return bucketAliases.some((alias) => haystack.includes(normalize(alias)));
}

async function getMaxExistingCfid() {
  let from = 0;
  const pageSize = 1000;
  let maxCfid = 0;

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabaseAdmin
      .from(ACCOUNTS_TABLE)
      .select('cfid')
      .not('cfid', 'is', null)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to read existing CFIDs: ${error.message}`);
    }

    const rows = data ?? [];

    for (const row of rows) {
      const numeric = getNumericCfid(row.cfid);
      if (numeric != null && numeric > maxCfid) {
        maxCfid = numeric;
      }
    }

    if (rows.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return maxCfid;
}

async function buildProductCodeResolver() {
  const { data, error } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('name,code,is_active')
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to read products: ${error.message}`);
  }

  const products = data ?? [];

  function canonicalize(value: unknown) {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_loans$/, '_loan')
      .replace(/_cards$/, '_card');
  }

  const byCanonical = new Map<string, string>();

  for (const product of products) {
    const code = String(product.code || '').trim();
    const name = String(product.name || '').trim();

    if (code) {
      byCanonical.set(canonicalize(code), code);
    }

    if (name) {
      byCanonical.set(canonicalize(name), code);
    }
  }

  return function resolveProductCode(value: unknown) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;

    return byCanonical.get(canonicalize(raw)) ?? null;
  };
}

async function resolveStrategyForAccount(input: {
  accountId: string;
  productCode: string | null;
  dpd: number | null;
}) {
  const productCode = normalizeProductCode(input.productCode);

  if (!productCode) {
    return {
      ok: false as const,
      error: 'Account has no product_code.',
    };
  }

  const { data: product, error: pErr } = await supabaseAdmin
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

  const { data: mapped, error: mErr } = await supabaseAdmin
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

  const { data: strategies, error: sErr } = await supabaseAdmin
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

async function assignStrategyToAccount(input: {
  accountId: string;
  productCode: string | null;
  dpd: number | null;
}) {
  const resolved = await resolveStrategyForAccount(input);

  if (!resolved.ok) {
    return resolved;
  }

  const { data: currentActive, error: currentErr } = await supabaseAdmin
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

  const { error: offErr } = await supabaseAdmin
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

  const { error: insErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .insert({
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
    (row) => String(row?.['DEBTOR NAMES'] || '').trim() !== ''
  );

  if (!filteredRows.length) {
    return NextResponse.json({ error: 'No valid rows found to import.' }, { status: 400 });
  }

  let resolveProductCode: (value: unknown) => string | null;

  try {
    resolveProductCode = await buildProductCodeResolver();
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to read products.' },
      { status: 500 }
    );
  }

  let maxExistingCfid = 0;

  try {
    maxExistingCfid = await getMaxExistingCfid();
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to read existing CFIDs.' },
      { status: 500 }
    );
  }

  console.log('IMPORT DEBUG maxExistingCfid:', maxExistingCfid);

  let nextNumber = maxExistingCfid + 1;

  const payload = filteredRows.map((row) => {
    const cfid = padCfid(nextNumber);
    nextNumber += 1;

    return {
      company_id: COMPANY_ID,
      cfid,
      debtor_name: cleanText(row['DEBTOR NAMES']),
      identification: cleanText(row['IDENTIFICATION']),
      contacts: cleanText(row['CONTACT(s)']),
      primary_phone: getPrimaryPhone(row['CONTACT(s)']),
      emails: cleanText(row['EMAIL(s)']),
      account_no: cleanText(row['ACCOUNT NO.']),
      service_account: cleanText(row['SERVICE ACCOUNT']),
      contract_no: cleanText(row['CONTRACT NO.']),
      debt_category: cleanText(row['DEBT CATEGORY']),
      debt_type: cleanText(row['DEBT TYPE']),
      currency: cleanText(row['CURRENCY']) || 'KES',
      principal_amount: toNumber(row['PRINCIPAL AMOUNT']),
      outsourced_amount: toNumber(row['OUTSOURCED AMOUNT']),
      amount_paid: toNumber(row['AMOUNT PAID']) ?? 0,
      arrears: toNumber(row['ARREARS']),
      balance: toNumber(row['BALANCE']) ?? 0,
      waiver: toNumber(row['WAIVER']),
      balance_after_waiver: toNumber(row['BALANCE AFTER WAIVER']),
      loan_taken_date: toDate(row['LOAN TAKEN DATE']),
      loan_due_date: toDate(row['LOAN DUE DATE']),
      outsource_date: toDate(row['OUTSOURCE DATE']),
      amount_repaid: toNumber(row['AMOUNT REPAID']),
      client_name: cleanText(row['CLIENT']),
      product: normalizeProduct(row['PRODUCT']),
      product_code: resolveProductCode(row['PRODUCT']),
      dpd: toInteger(row['DPD']) ?? 0,
      dpd_level: cleanText(row['DPD LEVEL']),
      emi: toNumber(row['EMI']),
      collector_name: cleanText(row['HELD BY']),
      held_by: cleanText(row['HELD BY']),
      held_for_days: toInteger(row['HELD FOR DAYS']),
      contactability: cleanText(row['CONTACTABILITY']),
      contact_type: cleanText(row['CONTACT TYPE']),
      contact_status: cleanText(row['CONTACT STATUS']),
      status: normalizeStatus(row),
      days_since_outsource: toInteger(row['DAYS SINCE OUTSOURCE']),
      last_pay_date: toDate(row['LAST PAY DATE']),
      last_pay_amount: toNumber(row['LAST PAY AMOUNT']),
      last_action_date: toDate(row['LAST ACTION DATE']),
      next_action_date: toDate(row['NEXT ACTION DATE']),
      last_rpc_updated_date: toDate(row['LAST RPC UPDATED DATE']),
      user_id_ref: cleanText(row['USER ID']),
      branch: cleanText(row['BRANCH']),
      customer_id: cleanText(row['CUSTOMER_ID']),
      batch_no: cleanText(row['BATCH NO']),
      loans_counter: toInteger(row['LOANS COUNTER']),
      non_payment_reason: cleanText(row['NON PAYMENT REASON']),
      employer_name: cleanText(row['EMPLOYER']),
      employer_details: cleanText(row['EMPLOYER']),
      risk_category: cleanText(row['RISK CATEGORY']),
      segments: cleanText(row['SEGMENTS']),
      employment_status: 'UNKNOWN',
    };
  });

  const { data: insertedAccounts, error: insertError } = await supabaseAdmin
    .from(ACCOUNTS_TABLE)
    .insert(payload)
    .select('id,cfid,product_code,dpd');

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const strategyResults = [];
  let assignedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const account of insertedAccounts || []) {
    const result = await assignStrategyToAccount({
      accountId: String(account.id),
      productCode: account.product_code,
      dpd: typeof account.dpd === 'number' ? account.dpd : toInteger(account.dpd),
    });

    if (result.ok && result.skipped) {
      skippedCount += 1;
      strategyResults.push({
        accountId: account.id,
        cfid: account.cfid,
        status: 'skipped',
        strategyId: result.strategyId,
        strategyName: result.strategyName,
        meta: result.meta,
      });
      continue;
    }

    if (result.ok) {
      assignedCount += 1;
      strategyResults.push({
        accountId: account.id,
        cfid: account.cfid,
        status: 'assigned',
        strategyId: result.strategyId,
        strategyName: result.strategyName,
        meta: result.meta,
      });
      continue;
    }

    failedCount += 1;
    strategyResults.push({
      accountId: account.id,
      cfid: account.cfid,
      status: 'failed',
      error: result.error,
    });
  }

  return NextResponse.json({
    success: true,
    importedCount: insertedAccounts?.length || 0,
    strategySummary: {
      assignedCount,
      skippedCount,
      failedCount,
    },
    strategyResults,
  });
}