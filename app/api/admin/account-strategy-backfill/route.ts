import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const ASSIGN_TABLE = 'account_strategies';
const ACCOUNTS_TABLE = 'accounts';
const STRATEGIES_TABLE = 'strategies';
const MAP_TABLE = 'strategy_products';
const PRODUCTS_TABLE = 'products';

function requireAdminKey(req: NextRequest) {
  const key = req.headers.get('x-admin-key');
  return Boolean(process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY);
}

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
  return parseDateLike(account?.created_at) || parseDateLike(account?.outsource_date) || null;
}

function getAccountDpd(account: any): number | null {
  const baseDpd = parseNumber(account?.dpd);
  if (baseDpd == null) return null;

  const anchor = getDpdAnchorDate(account);
  if (!anchor) return baseDpd;

  const today = new Date();
  const daysElapsed = diffInDays(anchor, today);

  return baseDpd + daysElapsed;
}

function getBucketMeta(dpd: number | null) {
  if (dpd == null) {
    return {
      key: 'unknown',
      label: 'Unknown',
      aliases: [] as string[],
      keywords: [] as string[],
    };
  }

  if (dpd <= 0) {
    return {
      key: 'current',
      label: 'Current',
      aliases: ['current', '0', '0+', 'dpd 0', '0-0'],
      keywords: ['current', 'pre-delinquency', 'predelinquency', 't-7', 't0', 'before due'],
    };
  }

  if (dpd >= 1 && dpd <= 30) {
    return {
      key: '1_30',
      label: '1-30',
      aliases: ['1-30', '01-30', '1 to 30', 'dpd 1-30', '1_30', '1–30'],
      keywords: ['1-30', '01-30', 'early stage', 'soft collections', 'soft collection', 'self-cure', 'self cure'],
    };
  }

  if (dpd >= 31 && dpd <= 60) {
    return {
      key: '31_60',
      label: '31-60',
      aliases: ['31-60', '31 to 60', 'dpd 31-60', '31_60', '31–60'],
      keywords: ['31-60', 'mid-stage', 'mid stage', 'mid stage collections', 'mid-stage collections'],
    };
  }

  if (dpd >= 61 && dpd <= 90) {
    return {
      key: '61_90',
      label: '61-90',
      aliases: ['61-90', '61 to 90', 'dpd 61-90', '61_90', '61–90'],
      keywords: ['61-90', 'late-stage', 'late stage', 'late stage collections', 'late-stage collections'],
    };
  }

  if (dpd >= 91 && dpd <= 120) {
    return {
      key: '91_120',
      label: '91-120',
      aliases: ['91-120', '91 to 120', 'dpd 91-120', '91_120', '91–120'],
      keywords: ['91-120', 'pre-charge-off', 'pre charge off', 'pre write-off', 'pre write off', 'serious delinquency'],
    };
  }

  return {
    key: '121_plus',
    label: '121+',
    aliases: ['121+', '121 plus', '120+', '120 plus', '121_and_above', '121 and above', 'over 120'],
    keywords: [
      '121+',
      '120+',
      'charge-off',
      'charge off',
      'post charge-off',
      'post-charge-off',
      'recovery',
      'recoveries',
      'write-off',
      'write off',
      'collections recovery',
      'late recovery',
    ],
  };
}

function scoreBucketMatch(strategy: any, bucketMeta: ReturnType<typeof getBucketMeta>) {
  const haystack = `${normalize(strategy?.name)} ${normalize(strategy?.description)}`;
  let score = 0;

  for (const alias of bucketMeta.aliases) {
    if (haystack.includes(normalize(alias))) score += 10;
  }

  for (const keyword of bucketMeta.keywords) {
    if (haystack.includes(normalize(keyword))) score += 4;
  }

  if (bucketMeta.key === '121_plus') {
    if (haystack.includes('recovery')) score += 6;
    if (haystack.includes('charge-off') || haystack.includes('charge off')) score += 6;
    if (haystack.includes('write-off') || haystack.includes('write off')) score += 6;
  }

  if (bucketMeta.key === '91_120') {
    if (haystack.includes('pre-charge-off') || haystack.includes('pre charge off')) score += 6;
  }

  if (bucketMeta.key === '61_90') {
    if (haystack.includes('late-stage') || haystack.includes('late stage')) score += 6;
  }

  if (bucketMeta.key === '31_60') {
    if (haystack.includes('mid-stage') || haystack.includes('mid stage')) score += 6;
  }

  if (bucketMeta.key === '1_30') {
    if (
      haystack.includes('early stage') ||
      haystack.includes('soft collections') ||
      haystack.includes('self-cure') ||
      haystack.includes('self cure')
    ) {
      score += 6;
    }
  }

  if (bucketMeta.key === 'current') {
    if (
      haystack.includes('pre-delinquency') ||
      haystack.includes('predelinquency') ||
      haystack.includes('before due')
    ) {
      score += 6;
    }
  }

  return score;
}

function chooseBestBucketStrategy(strategies: any[], bucketMeta: ReturnType<typeof getBucketMeta>) {
  const scored = strategies
    .map((strategy) => ({ strategy, score: scoreBucketMatch(strategy, bucketMeta) }))
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored[0].score <= 0) return null;
  return scored[0].strategy;
}

async function resolveAutoStrategyForAccount(account: any) {
  const productCode = normalize(account.product_code);
  if (!productCode) {
    return { ok: false as const, error: 'Account has no product_code.' };
  }

  const dpd = getAccountDpd(account);
  const bucket = getBucketMeta(dpd);

  const { data: product, error: pErr } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,code,is_active')
    .eq('code', productCode)
    .maybeSingle();

  if (pErr) return { ok: false as const, error: pErr.message };
  if (!product || product.is_active === false) {
    return { ok: false as const, error: `Unknown or inactive product_code: ${productCode}` };
  }

  const { data: mapped, error: mErr } = await supabaseAdmin
    .from(MAP_TABLE)
    .select('strategy_id,is_active')
    .eq('product_id', product.id);

  if (mErr) return { ok: false as const, error: mErr.message };

  const mappedStrategyIds = (mapped ?? [])
    .filter((r: any) => r && r.is_active !== false)
    .map((r: any) => String(r.strategy_id));

  if (mappedStrategyIds.length === 0) {
    return { ok: false as const, error: `No strategies mapped to product_code=${productCode} yet.` };
  }

  const { data: strategies, error: sErr } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .select('id,name,description,is_active,sort_order,created_at')
    .in('id', mappedStrategyIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (sErr) return { ok: false as const, error: sErr.message };

  const activeStrategies = strategies ?? [];
  if (activeStrategies.length === 0) {
    return { ok: false as const, error: 'No active strategy found for this product.' };
  }

  const bucketSpecific = chooseBestBucketStrategy(activeStrategies, bucket);
  const chosen = bucketSpecific ?? activeStrategies[0];

  return {
    ok: true as const,
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

async function assignResolvedStrategy(accountId: string, strategyId: string, notes: string) {
  const { error: offErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .update({ is_active: false })
    .eq('account_id', accountId)
    .eq('is_active', true);

  if (offErr) {
    return { ok: false as const, error: offErr.message };
  }

  const { error: insErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .insert({
      account_id: accountId,
      strategy_id: strategyId,
      source: 'auto',
      notes,
      is_active: true,
    });

  if (insErr) {
    return { ok: false as const, error: insErr.message };
  }

  return { ok: true as const };
}

export async function POST(req: NextRequest) {
  try {
    if (!requireAdminKey(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
    }

    const body = await readJsonSafe(req);
    const limitRaw = Number(body.limit ?? 200);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 200;

    const { data: activeAssignments, error: activeErr } = await supabaseAdmin
      .from(ASSIGN_TABLE)
      .select('account_id')
      .eq('is_active', true);

    if (activeErr) {
      return NextResponse.json({ error: activeErr.message }, { status: 500 });
    }

    const activeAccountIds = new Set(
      (activeAssignments ?? [])
        .map((row: any) => String(row.account_id || '').trim())
        .filter(Boolean)
    );

    const fetchLimit = Math.max(limit * 3, limit);

    const { data: accounts, error: accErr } = await supabaseAdmin
      .from(ACCOUNTS_TABLE)
      .select('id,product_code,dpd,created_at,outsource_date')
      .not('product_code', 'is', null)
      .order('created_at', { ascending: false })
      .limit(fetchLimit);

    if (accErr) {
      return NextResponse.json({ error: accErr.message }, { status: 500 });
    }

    const candidates = (accounts ?? []).filter(
      (account: any) => !activeAccountIds.has(String(account.id))
    );

    const rows = candidates.slice(0, limit);

    let assignedCount = 0;
    let failedCount = 0;
    const results: any[] = [];

    for (const account of rows) {
      try {
        const resolved = await resolveAutoStrategyForAccount(account);
        if (!resolved.ok) {
          failedCount += 1;
          results.push({
            accountId: account.id,
            status: 'failed',
            error: resolved.error,
          });
          continue;
        }

        const notes = [
          'Bulk backfill auto-assigned by product/bucket.',
          `product=${resolved.meta.productCode}`,
          `dpd=${resolved.meta.dpd ?? 'unknown'}`,
          `bucket=${resolved.meta.bucket}`,
          `match=${resolved.meta.matchedBy}`,
        ].join(' ');

        const assigned = await assignResolvedStrategy(String(account.id), resolved.strategyId, notes);
        if (!assigned.ok) {
          failedCount += 1;
          results.push({
            accountId: account.id,
            status: 'failed',
            error: assigned.error,
          });
          continue;
        }

        assignedCount += 1;
        results.push({
          accountId: account.id,
          status: 'assigned',
          strategyId: resolved.strategyId,
          strategyName: resolved.meta.strategyName,
          meta: resolved.meta,
        });
      } catch (error: any) {
        failedCount += 1;
        results.push({
          accountId: account.id,
          status: 'failed',
          error: error?.message || 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      scannedWithProductCount: (accounts ?? []).length,
      eligibleWithoutActiveStrategyCount: candidates.length,
      processedCount: rows.length,
      assignedCount,
      failedCount,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Backfill failed unexpectedly.' },
      { status: 500 }
    );
  }
}