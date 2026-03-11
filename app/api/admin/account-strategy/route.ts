import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAdminRole } from '@/lib/server-auth';

const ASSIGN_TABLE = 'account_strategies';
const ACCOUNTS_TABLE = 'accounts';
const STRATEGIES_TABLE = 'strategies';
const MAP_TABLE = 'strategy_products';
const PRODUCTS_TABLE = 'products';

async function readJsonSafe(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getAccountDpd(account: any): number | null {
  const candidates = [
    account?.dpd,
    account?.days_past_due,
    account?.days_overdue,
    account?.delinquency_days,
    account?.bucket_days,
  ];

  for (const value of candidates) {
    const parsed = parseNumber(value);
    if (parsed != null) return parsed;
  }

  return null;
}

function getBucketMeta(dpd: number | null) {
  if (dpd == null) {
    return { key: 'unknown', label: 'Unknown', aliases: [] as string[] };
  }
  if (dpd <= 0) {
    return { key: 'current', label: 'Current', aliases: ['current', '0', '0+', 'dpd 0', '0-0'] };
  }
  if (dpd >= 1 && dpd <= 30) {
    return { key: '1_30', label: '1-30', aliases: ['1-30', '01-30', '1 to 30', 'dpd 1-30', '1_30', '1–30'] };
  }
  if (dpd >= 31 && dpd <= 60) {
    return { key: '31_60', label: '31-60', aliases: ['31-60', '31 to 60', 'dpd 31-60', '31_60', '31–60'] };
  }
  if (dpd >= 61 && dpd <= 90) {
    return { key: '61_90', label: '61-90', aliases: ['61-90', '61 to 90', 'dpd 61-90', '61_90', '61–90'] };
  }
  if (dpd >= 91 && dpd <= 120) {
    return { key: '91_120', label: '91-120', aliases: ['91-120', '91 to 120', 'dpd 91-120', '91_120', '91–120'] };
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

async function resolveAutoStrategy(accountId: string) {
  if (!supabaseAdmin) {
    return { error: 'Supabase admin not configured.', status: 500 as const };
  }

  const { data: acct, error: acctErr } = await supabaseAdmin
    .from(ACCOUNTS_TABLE)
    .select('id,product_code,dpd')
    .eq('id', accountId)
    .maybeSingle();

  if (acctErr) return { error: acctErr.message, status: 500 as const };
  if (!acct) return { error: 'Account not found.', status: 404 as const };

  const productCode = normalize(acct.product_code);
  if (!productCode) {
    return {
      error: 'Account has no product_code. Set accounts.product_code first, then auto-assign.',
      status: 400 as const,
    };
  }

  const dpd = getAccountDpd(acct);
  const bucket = getBucketMeta(dpd);

  const { data: product, error: pErr } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,code,is_active')
    .eq('code', productCode)
    .maybeSingle();

  if (pErr) return { error: pErr.message, status: 500 as const };
  if (!product || product.is_active === false) {
    return { error: `Unknown or inactive product_code: ${productCode}`, status: 400 as const };
  }

  const { data: mapped, error: mErr } = await supabaseAdmin
    .from(MAP_TABLE)
    .select('strategy_id,is_active')
    .eq('product_id', product.id);

  if (mErr) return { error: mErr.message, status: 500 as const };

  const mappedStrategyIds = (mapped ?? [])
    .filter((r: any) => r && r.is_active !== false)
    .map((r: any) => String(r.strategy_id));

  if (mappedStrategyIds.length === 0) {
    return {
      error: `No strategies mapped to product_code=${productCode} yet.`,
      status: 400 as const,
    };
  }

  const { data: strategies, error: strategiesErr } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .select('id,name,description,is_active,sort_order,created_at')
    .in('id', mappedStrategyIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (strategiesErr) return { error: strategiesErr.message, status: 500 as const };

  const activeStrategies = strategies ?? [];
  if (activeStrategies.length === 0) {
    return { error: 'No active strategy found for this product.', status: 400 as const };
  }

  const bucketSpecific = activeStrategies.find((strategy: any) =>
    matchesBucket(strategy, bucket.aliases)
  );

  const chosen = bucketSpecific ?? activeStrategies[0];

  return {
    strategyId: String(chosen.id),
    meta: {
      productCode,
      dpd,
      bucket: bucket.label,
      matchedBy: bucketSpecific ? 'product_and_bucket' : 'product_fallback',
      strategyName: chosen.name ?? null,
    },
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const url = new URL(req.url);
  const accountId = url.searchParams.get('accountId')?.trim() || '';

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  }

  const { data: assignment, error: aErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .select('id,account_id,strategy_id,assigned_at,assigned_by,source,notes,is_active')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!assignment) return NextResponse.json({ assignment: null, strategy: null });

  const { data: strategy, error: sErr } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .select('id,name,description,is_active,sort_order,steps,created_at,updated_at')
    .eq('id', assignment.strategy_id)
    .maybeSingle();

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  return NextResponse.json({ assignment, strategy: strategy ?? null });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const body = await readJsonSafe(req);

  const accountId = body.accountId != null ? String(body.accountId).trim() : '';
  let strategyId = body.strategyId != null ? String(body.strategyId).trim() : '';
  let source = body.source != null ? String(body.source).trim() : strategyId ? 'manual' : 'auto';
  let notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required.' }, { status: 400 });
  }

  let autoMeta: Record<string, unknown> | null = null;

  if (!strategyId) {
    const resolved = await resolveAutoStrategy(accountId);

    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    strategyId = resolved.strategyId;
    autoMeta = resolved.meta;
    source = source || 'auto';

    const autoNote = [
      'Auto-assigned by product/bucket.',
      `product=${resolved.meta.productCode}`,
      `dpd=${resolved.meta.dpd ?? 'unknown'}`,
      `bucket=${resolved.meta.bucket}`,
      `match=${resolved.meta.matchedBy}`,
    ].join(' ');

    notes = notes ? `${notes} | ${autoNote}` : autoNote;
  }

  const { data: currentActive, error: currentErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .select('id,strategy_id,source,notes,is_active')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });

  if (currentActive && String(currentActive.strategy_id) === strategyId) {
    const { data: strategy, error: sErr } = await supabaseAdmin
      .from(STRATEGIES_TABLE)
      .select('id,name,is_active')
      .eq('id', strategyId)
      .maybeSingle();

    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

    return NextResponse.json({
      assignment: currentActive,
      strategy: strategy ?? null,
      skipped: true,
      reason: 'Strategy already active for this account.',
      autoMeta,
    });
  }

  const { error: offErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .update({ is_active: false })
    .eq('account_id', accountId)
    .eq('is_active', true);

  if (offErr) return NextResponse.json({ error: offErr.message }, { status: 500 });

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .insert({
      account_id: accountId,
      strategy_id: strategyId,
      source,
      notes,
      is_active: true,
    })
    .select('id,account_id,strategy_id,assigned_at,assigned_by,source,notes,is_active')
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const { data: strategy, error: sErr } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .select('id,name,is_active')
    .eq('id', strategyId)
    .maybeSingle();

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  return NextResponse.json({
    assignment: inserted,
    strategy: strategy ?? null,
    autoMeta,
  });
}