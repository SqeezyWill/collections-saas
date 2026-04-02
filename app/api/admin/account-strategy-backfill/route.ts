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

async function resolveAutoStrategy(accountId: string) {
  if (!supabaseAdmin) {
    return { error: 'Supabase admin not configured.', status: 500 as const };
  }

  const { data: acct, error: acctErr } = await supabaseAdmin
    .from(ACCOUNTS_TABLE)
    .select('id,product_code,dpd,status,balance,total_due')
    .eq('id', accountId)
    .maybeSingle();

  if (acctErr) {
    return { error: acctErr.message, status: 500 as const };
  }

  if (!acct) {
    return { error: 'Account not found.', status: 404 as const };
  }

  const accountStatus = normalize(acct.status);
  const balance = parseNumber((acct as any).balance) ?? 0;
  const totalDue = parseNumber((acct as any).total_due) ?? 0;

  const isClosedAccount =
    accountStatus === 'closed' || (balance <= 0 && totalDue <= 0);

  if (isClosedAccount) {
    return {
      error: 'Closed or fully paid account skipped.',
      status: 400 as const,
      skipped: true as const,
      closedLike: true as const,
    };
  }

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

  if (pErr) {
    return { error: pErr.message, status: 500 as const };
  }

  if (!product || product.is_active === false) {
    return {
      error: `Unknown or inactive product_code: ${productCode}`,
      status: 400 as const,
    };
  }

  const { data: mapped, error: mErr } = await supabaseAdmin
    .from(MAP_TABLE)
    .select('strategy_id,is_active')
    .eq('product_id', product.id);

  if (mErr) {
    return { error: mErr.message, status: 500 as const };
  }

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

  if (strategiesErr) {
    return { error: strategiesErr.message, status: 500 as const };
  }

  const activeStrategies = strategies ?? [];
  if (activeStrategies.length === 0) {
    return {
      error: 'No active strategy found for this product.',
      status: 400 as const,
    };
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

export async function POST(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const body = await readJsonSafe(req);
  const limitRaw = body.limit != null ? Number(body.limit) : 100;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 100;

  const { data: accounts, error: accountsErr } = await supabaseAdmin
    .from(ACCOUNTS_TABLE)
    .select('id,product_code,dpd,status,created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (accountsErr) {
    return NextResponse.json({ error: accountsErr.message }, { status: 500 });
  }

  const rows = accounts ?? [];
  const results: Array<Record<string, unknown>> = [];

  let assignedCount = 0;
  let unchangedCount = 0;
  let reassignedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const acct of rows) {
    const accountId = String(acct.id);

    const resolved = await resolveAutoStrategy(accountId);

    if ('error' in resolved) {
      if ((resolved as any).skipped) {
        if ((resolved as any).closedLike) {
          const { error: deactivateClosedErr } = await supabaseAdmin
            .from(ASSIGN_TABLE)
            .update({ is_active: false })
            .eq('account_id', accountId)
            .eq('is_active', true);

          if (deactivateClosedErr) {
            failedCount += 1;
            results.push({
              accountId,
              status: 'failed',
              error: deactivateClosedErr.message,
            });
            continue;
          }

          skippedCount += 1;
          results.push({
            accountId,
            status: 'closed_skipped',
            reason: resolved.error,
          });
          continue;
        }

        skippedCount += 1;
        results.push({
          accountId,
          status: 'skipped',
          reason: resolved.error,
        });
      } else {
        failedCount += 1;
        results.push({
          accountId,
          status: 'failed',
          error: resolved.error,
        });
      }
      continue;
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(ASSIGN_TABLE)
      .select('id,strategy_id,is_active')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingErr) {
      failedCount += 1;
      results.push({
        accountId,
        status: 'failed',
        error: existingErr.message,
      });
      continue;
    }

    if (existing && String(existing.strategy_id) === resolved.strategyId) {
      unchangedCount += 1;
      results.push({
        accountId,
        status: 'unchanged',
        strategyId: resolved.strategyId,
        strategyName: resolved.meta.strategyName,
        meta: resolved.meta,
      });
      continue;
    }

    if (existing) {
      const { error: deactivateErr } = await supabaseAdmin
        .from(ASSIGN_TABLE)
        .update({ is_active: false })
        .eq('account_id', accountId)
        .eq('is_active', true);

      if (deactivateErr) {
        failedCount += 1;
        results.push({
          accountId,
          status: 'failed',
          error: deactivateErr.message,
        });
        continue;
      }
    }

    const autoNote = [
      existing ? 'Auto-reassigned by product/bucket change.' : 'Auto-assigned by product/bucket.',
      `product=${resolved.meta.productCode}`,
      `dpd=${resolved.meta.dpd ?? 'unknown'}`,
      `bucket=${resolved.meta.bucket}`,
      `match=${resolved.meta.matchedBy}`,
    ].join(' ');

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from(ASSIGN_TABLE)
      .insert({
        account_id: accountId,
        strategy_id: resolved.strategyId,
        source: 'auto',
        notes: autoNote,
        is_active: true,
      })
      .select('id,account_id,strategy_id')
      .single();

    if (insertErr) {
      failedCount += 1;
      results.push({
        accountId,
        status: 'failed',
        error: insertErr.message,
      });
      continue;
    }

    if (existing) {
      reassignedCount += 1;
      results.push({
        accountId,
        status: 'reassigned',
        previousStrategyId: existing.strategy_id,
        strategyId: inserted.strategy_id,
        strategyName: resolved.meta.strategyName,
        meta: resolved.meta,
      });
    } else {
      assignedCount += 1;
      results.push({
        accountId,
        status: 'assigned',
        strategyId: inserted.strategy_id,
        strategyName: resolved.meta.strategyName,
        meta: resolved.meta,
      });
    }
  }

  return NextResponse.json({
    success: true,
    scannedCount: rows.length,
    assignedCount,
    reassignedCount,
    unchangedCount,
    skippedCount,
    failedCount,
    results,
  });
}