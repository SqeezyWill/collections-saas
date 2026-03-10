import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const STRATEGIES_TABLE = 'strategies';
const MAP_TABLE = 'strategy_products';
const PRODUCTS_TABLE = 'products';

function requireAdminKey(req: NextRequest) {
  const key = req.headers.get('x-admin-key');
  return Boolean(process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY);
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const url = new URL(req.url);
  const productId = url.searchParams.get('productId')?.trim() || '';
  const productCode = url.searchParams.get('productCode')?.trim().toLowerCase() || '';

  const { data: strategiesData, error: strategiesError } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .select('id,name,description,is_active,sort_order,steps,created_at,updated_at')
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (strategiesError) {
    return NextResponse.json({ error: strategiesError.message }, { status: 500 });
  }

  const strategies = (strategiesData ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? null,
    is_active: Boolean(s.is_active),
    sort_order: typeof s.sort_order === 'number' ? s.sort_order : null,
    steps: s.steps ?? [],
    created_at: s.created_at ?? null,
    updated_at: s.updated_at ?? null,
    products: [] as Array<{
      id: string;
      code: string;
      name: string;
      category: string | null;
      is_active?: boolean;
      sort_order?: number;
    }>,
    product_ids: [] as string[],
    product_codes: [] as string[],
  }));

  if (strategies.length === 0) {
    return NextResponse.json({ strategies: [] });
  }

  const strategyIds = strategies.map((s) => s.id);

  const { data: mapData, error: mapError } = await supabaseAdmin
    .from(MAP_TABLE)
    .select('strategy_id,product_id,is_active')
    .in('strategy_id', strategyIds);

  if (mapError) {
    return NextResponse.json({ error: mapError.message }, { status: 500 });
  }

  const mapRows = (mapData ?? []).filter((r: any) => r && r.is_active !== false);
  const productIds = uniq(mapRows.map((r: any) => String(r.product_id)));

  const productsById = new Map<string, any>();

  if (productIds.length > 0) {
    const { data: productsData, error: productsError } = await supabaseAdmin
      .from(PRODUCTS_TABLE)
      .select('id,code,name,category,is_active,sort_order')
      .in('id', productIds);

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 });
    }

    for (const p of productsData ?? []) {
      productsById.set(String(p.id), {
        id: String(p.id),
        code: String(p.code || '').toLowerCase(),
        name: String(p.name || ''),
        category: p.category ?? null,
        is_active: Boolean(p.is_active),
        sort_order: typeof p.sort_order === 'number' ? p.sort_order : 0,
      });
    }
  }

  const mapByStrategy = new Map<string, string[]>();
  for (const r of mapRows as any[]) {
    const sid = String(r.strategy_id);
    const pid = String(r.product_id);
    const list = mapByStrategy.get(sid) ?? [];
    list.push(pid);
    mapByStrategy.set(sid, list);
  }

  for (const s of strategies) {
    const pids = mapByStrategy.get(s.id) ?? [];
    const products = pids
      .map((pid) => productsById.get(pid))
      .filter(Boolean)
      .filter((p: any) => p.is_active !== false)
      .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    s.products = products;
    s.product_ids = products.map((p: any) => p.id);
    s.product_codes = products.map((p: any) => p.code);
  }

  let filtered = strategies;

  if (productId) {
    filtered = filtered
      .filter((s) => s.product_ids.includes(productId))
      .map((s) => {
        const only = s.products.filter((p) => String(p.id) === productId);
        return {
          ...s,
          products: only,
          product_ids: only.map((p) => p.id),
          product_codes: only.map((p) => p.code),
        };
      });
  } else if (productCode) {
    const code = productCode.toLowerCase();
    filtered = filtered
      .filter((s) => s.product_codes.includes(code))
      .map((s) => {
        const only = s.products.filter((p) => String(p.code).toLowerCase() === code);
        return {
          ...s,
          products: only,
          product_ids: only.map((p) => p.id),
          product_codes: only.map((p) => p.code),
        };
      });
  }

  return NextResponse.json({ strategies: filtered });
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));

  const name = body.name != null ? String(body.name).trim() : '';
  const description =
    body.description != null && String(body.description).trim()
      ? String(body.description).trim()
      : null;

  const sort_order =
    body.sortOrder != null && String(body.sortOrder).trim() !== ''
      ? Number(body.sortOrder)
      : body.sort_order != null && String(body.sort_order).trim() !== ''
      ? Number(body.sort_order)
      : 0;

  const is_active =
    body.isActive != null
      ? Boolean(body.isActive)
      : body.is_active != null
      ? Boolean(body.is_active)
      : true;

  const steps = Array.isArray(body.steps) ? body.steps : [];
  const productIds: string[] = Array.isArray(body.productIds)
    ? body.productIds.map((x: any) => String(x)).filter(Boolean)
    : [];

  if (!name) {
    return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  }

  const { data: created, error: createError } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .insert({
      name,
      description,
      is_active,
      sort_order: Number.isFinite(sort_order) ? sort_order : 0,
      steps,
    })
    .select('id,name,description,is_active,sort_order,steps,created_at,updated_at')
    .single();

  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  if (productIds.length > 0) {
    const rows = productIds.map((pid) => ({
      strategy_id: created.id,
      product_id: pid,
      is_active: true,
    }));

    const { error: mapInsertError } = await supabaseAdmin.from(MAP_TABLE).insert(rows);
    if (mapInsertError) {
      return NextResponse.json({ error: mapInsertError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    strategy: {
      id: created.id,
      name: created.name,
      description: created.description ?? null,
      is_active: Boolean(created.is_active),
      sort_order: typeof created.sort_order === 'number' ? created.sort_order : 0,
      steps: created.steps ?? [],
      created_at: created.created_at ?? null,
      updated_at: created.updated_at ?? null,
      product_ids: productIds,
    },
  });
}

export async function PUT(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const productId = body.productId != null ? String(body.productId).trim() : '';
  const strategyIds: string[] = Array.isArray(body.strategyIds)
    ? uniq(body.strategyIds.map((x: any) => String(x)).filter(Boolean))
    : [];

  if (!productId) {
    return NextResponse.json({ error: 'productId is required.' }, { status: 400 });
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,code,name,is_active')
    .eq('id', productId)
    .maybeSingle();

  if (productError) {
    return NextResponse.json({ error: productError.message }, { status: 500 });
  }

  if (!product) {
    return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
  }

  const { data: existingMaps, error: existingError } = await supabaseAdmin
    .from(MAP_TABLE)
    .select('strategy_id,product_id,is_active')
    .eq('product_id', productId);

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  const existingStrategyIds = uniq(
    (existingMaps ?? [])
      .filter((r: any) => r && r.is_active !== false)
      .map((r: any) => String(r.strategy_id))
  );

  const toDeactivate = existingStrategyIds.filter((id) => !strategyIds.includes(id));
  const toInsert = strategyIds.filter((id) => !existingStrategyIds.includes(id));

  if (toDeactivate.length > 0) {
    const { error: deactivateError } = await supabaseAdmin
      .from(MAP_TABLE)
      .update({ is_active: false })
      .eq('product_id', productId)
      .in('strategy_id', toDeactivate);

    if (deactivateError) {
      return NextResponse.json({ error: deactivateError.message }, { status: 500 });
    }
  }

  if (toInsert.length > 0) {
    const rows = toInsert.map((strategyId) => ({
      product_id: productId,
      strategy_id: strategyId,
      is_active: true,
    }));

    const { error: insertError } = await supabaseAdmin.from(MAP_TABLE).insert(rows);
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  if (strategyIds.length > 0) {
    const { error: reactivateError } = await supabaseAdmin
      .from(MAP_TABLE)
      .update({ is_active: true })
      .eq('product_id', productId)
      .in('strategy_id', strategyIds);

    if (reactivateError) {
      return NextResponse.json({ error: reactivateError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    product: {
      id: product.id,
      code: product.code,
      name: product.name,
    },
    mappedStrategyIds: strategyIds,
  });
}