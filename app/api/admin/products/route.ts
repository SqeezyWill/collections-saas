import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const TABLE = 'products';

function requireAdminKey(req: NextRequest) {
  const key = req.headers.get('x-admin-key');
  return Boolean(process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY);
}

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!supabaseAdmin)
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('id,code,name,category,is_active,sort_order,created_at,updated_at')
    .order('sort_order', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const products = (data ?? []).map((p: any) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    category: p.category ?? null,
    is_active: Boolean(p.is_active),
    sort_order: typeof p.sort_order === 'number' ? p.sort_order : 0,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
  }));

  return NextResponse.json({ products });
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!supabaseAdmin)
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });

  const body = await req.json().catch(() => ({}));

  const code = body.code != null ? String(body.code).trim().toLowerCase() : '';
  const name = body.name != null ? String(body.name).trim() : '';
  const category = body.category != null ? String(body.category).trim() : null;

  const sort_order =
    body.sortOrder != null && String(body.sortOrder).trim() !== ''
      ? Number(body.sortOrder)
      : body.sort_order != null && String(body.sort_order).trim() !== ''
        ? Number(body.sort_order)
        : 0;

  const is_active =
    body.isActive != null ? Boolean(body.isActive) : body.is_active != null ? Boolean(body.is_active) : true;

  if (!code || !name) {
    return NextResponse.json({ error: 'code and name are required.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      code,
      name,
      category,
      is_active,
      sort_order: Number.isFinite(sort_order) ? sort_order : 0,
    })
    .select('id,code,name,category,is_active,sort_order,created_at,updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    product: {
      id: data.id,
      code: data.code,
      name: data.name,
      category: data.category ?? null,
      is_active: Boolean(data.is_active),
      sort_order: typeof data.sort_order === 'number' ? data.sort_order : 0,
      created_at: data.created_at ?? null,
      updated_at: data.updated_at ?? null,
    },
  });
}