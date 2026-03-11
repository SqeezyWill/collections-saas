import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAdminRole, requireSuperAdminRole } from '@/lib/server-auth';

const TABLE = 'companies';

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const companies = (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    themeColor: c.theme_color ?? '#2563eb',
    logoUrl: c.logo_url ?? null,
    createdAt: c.created_at,
  }));

  return NextResponse.json({ companies });
}

export async function POST(req: NextRequest) {
  const auth = await requireSuperAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));

  const name = body.name != null ? String(body.name).trim() : '';
  const code = body.code != null ? String(body.code).trim().toUpperCase() : '';
  const themeColor = body.themeColor != null ? String(body.themeColor).trim() : '#2563eb';
  const logoUrl =
    body.logoUrl != null && String(body.logoUrl).trim() ? String(body.logoUrl).trim() : null;

  if (!name || !code) {
    return NextResponse.json({ error: 'name and code are required.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      name,
      code,
      theme_color: themeColor,
      logo_url: logoUrl,
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    company: {
      id: data.id,
      name: data.name,
      code: data.code,
      themeColor: data.theme_color ?? '#2563eb',
      logoUrl: data.logo_url ?? null,
      createdAt: data.created_at,
    },
  });
}