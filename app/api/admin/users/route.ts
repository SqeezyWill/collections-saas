import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getServerAuthContext } from '@/lib/server-auth';

const PROFILE_TABLE = 'user_profiles';
const COMPANIES_TABLE = 'companies';

async function resolveCompanyId(rawCompanyInput: unknown) {
  const input = String(rawCompanyInput || '').trim();
  if (!input) {
    throw new Error('Company is required.');
  }

  if (!supabaseAdmin) {
    throw new Error('Supabase admin is not configured.');
  }

  const lowered = input.toLowerCase();

  const { data: companies, error } = await supabaseAdmin
    .from(COMPANIES_TABLE)
    .select('id,name,code');

  if (error) {
    throw new Error(error.message);
  }

  const match =
    (companies || []).find((company: any) => String(company.id || '').toLowerCase() === lowered) ||
    (companies || []).find((company: any) => String(company.code || '').toLowerCase() === lowered) ||
    (companies || []).find((company: any) => String(company.name || '').trim().toLowerCase() === lowered);

  if (!match?.id) {
    throw new Error('Selected company could not be resolved.');
  }

  return String(match.id);
}

export async function GET(req: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin is not configured.' }, { status: 500 });
    }

    const auth = await getServerAuthContext(req);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 });
    }

    let q = supabaseAdmin.from(PROFILE_TABLE).select('id,name,email,role,company_id');

    const companyIdParam = req.nextUrl.searchParams.get('companyId')?.trim();

    if (auth.user.role === 'admin' && auth.user.companyId) {
      q = q.eq('company_id', auth.user.companyId);
    } else if (companyIdParam) {
      const resolvedCompanyId = await resolveCompanyId(companyIdParam);
      q = q.eq('company_id', resolvedCompanyId);
    }

    const { data, error } = await q.order('name', { ascending: true });

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
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to load users.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin is not configured.' }, { status: 500 });
    }

    const auth = await getServerAuthContext(req);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 });
    }

    if (auth.user.role !== 'super_admin' && auth.user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);

    const name = String(body?.name || '').trim();
    const email = String(body?.email || '').trim().toLowerCase();
    const role = String(body?.role || '').trim();
    const password = String(body?.password || '').trim();

    if (!name || !email || !role || !password) {
      return NextResponse.json(
        { error: 'Name, email, role, and password are required.' },
        { status: 400 }
      );
    }

    let companyId = await resolveCompanyId(body?.companyId);

    if (auth.user.role === 'admin') {
      if (!auth.user.companyId) {
        return NextResponse.json({ error: 'Admin user has no company scope.' }, { status: 400 });
      }
      companyId = auth.user.companyId;
    }

    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role,
        company_id: companyId,
      },
    });

    if (createError || !createdUser?.user?.id) {
      return NextResponse.json(
        { error: createError?.message || 'Failed to create auth user.' },
        { status: 400 }
      );
    }

    const authUserId = createdUser.user.id;

    const { error: profileError } = await supabaseAdmin.from(PROFILE_TABLE).upsert(
      {
        id: authUserId,
        name,
        email,
        role,
        company_id: companyId,
      },
      { onConflict: 'id' }
    );

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    return NextResponse.json({
      user: {
        id: authUserId,
        name,
        email,
        role,
        companyId,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to create user.' },
      { status: 500 }
    );
  }
}