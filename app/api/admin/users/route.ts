import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const PROFILE_TABLE = 'user_profiles';
const DEFAULT_PASSWORD = 'credcoll@2026';

function requireAdminKey(req: NextRequest) {
  const key = req.headers.get('x-admin-key');
  return Boolean(process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY);
}

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get('companyId')?.trim() || '';
  const role = searchParams.get('role')?.trim() || '';
  const search = searchParams.get('search')?.trim() || '';

  let q = supabaseAdmin
    .from(PROFILE_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (companyId) q = q.eq('company_id', companyId);
  if (role) q = q.eq('role', role);

  if (search) {
    const s = search.replace(/,/g, '');
    q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    companyId: row.company_id,
  }));

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || '').trim();
  const companyId = String(body.companyId || '').trim();
  const password = String(body.password || '').trim() || DEFAULT_PASSWORD;

  if (!name || !email || !role || !companyId) {
    return NextResponse.json(
      { error: 'name, email, role, companyId are required.' },
      { status: 400 }
    );
  }

  let authUserId: string | null = null;

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role, companyId },
    });

    if (error) throw error;
    authUserId = data.user?.id ?? null;
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Failed to create auth user.' },
      { status: 500 }
    );
  }

  if (!authUserId) {
    return NextResponse.json({ error: 'Failed to obtain user id.' }, { status: 500 });
  }

  const { error: profileError } = await supabaseAdmin
    .from(PROFILE_TABLE)
    .upsert(
      { id: authUserId, name, email, role, company_id: companyId },
      { onConflict: 'id' }
    );

  if (profileError) {
    return NextResponse.json(
      { error: `Auth user created but profile insert failed: ${profileError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    user: {
      id: authUserId,
      name,
      email,
      role,
      companyId,
      defaultPasswordApplied: !String(body.password || '').trim(),
    },
  });
}