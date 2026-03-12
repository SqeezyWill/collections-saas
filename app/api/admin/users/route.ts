import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAdminRole, requireSuperAdminRole } from '@/lib/server-auth';

const PROFILE_TABLE = 'user_profiles';
const DEFAULT_PASSWORD = 'credcoll@2026';

export async function GET(req: NextRequest) {
  const auth = await requireAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const companyIdParam = searchParams.get('companyId')?.trim() || '';
  const role = searchParams.get('role')?.trim() || '';
  const search = searchParams.get('search')?.trim() || '';

  let q = supabaseAdmin.from(PROFILE_TABLE).select('id,name,email,role,company_id');

  // super_admin can see all users; admin is restricted to their own tenant
  if (auth.user.role !== 'super_admin') {
    if (!auth.user.companyId) {
      return NextResponse.json({ error: 'No company assigned to current user.' }, { status: 403 });
    }
    q = q.eq('company_id', auth.user.companyId);
  } else if (companyIdParam) {
    q = q.eq('company_id', companyIdParam);
  }

  if (role) q = q.eq('role', role);

  if (search) {
    const s = search.replace(/,/g, '');
    q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%`);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = (data ?? [])
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      companyId: row.company_id,
    }))
    .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')));

  return NextResponse.json({ users });
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