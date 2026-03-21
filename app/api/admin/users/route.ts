import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireSuperAdminRole } from '@/lib/server-auth';

const PROFILE_TABLE = 'user_profiles';
const COMPANIES_TABLE = 'companies';
const FIXED_COMPANY_NAME = 'Pezesha';

async function resolveFixedCompanyId() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin is not configured.');
  }

  const lowered = FIXED_COMPANY_NAME.toLowerCase();

  const { data: companies, error } = await supabaseAdmin
    .from(COMPANIES_TABLE)
    .select('id,name,code');

  if (error) {
    throw new Error(error.message);
  }

  const match =
    (companies || []).find(
      (company: any) => String(company.name || '').trim().toLowerCase() === lowered
    ) ||
    (companies || []).find(
      (company: any) => String(company.code || '').trim().toLowerCase() === lowered
    );

  if (!match?.id) {
    throw new Error(`Fixed company "${FIXED_COMPANY_NAME}" could not be resolved.`);
  }

  return String(match.id);
}

async function getCompanyBranding(companyId: string) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin is not configured.');
  }

  const { data, error } = await supabaseAdmin
    .from(COMPANIES_TABLE)
    .select('id,name,logo_url,logoUrl')
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    company_name: (data as any)?.name ?? FIXED_COMPANY_NAME,
    company_logo_url: (data as any)?.logo_url || (data as any)?.logoUrl || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin is not configured.' }, { status: 500 });
    }

    const auth = await requireSuperAdminRole(req);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.status || 401 }
      );
    }

    const companyId = await resolveFixedCompanyId();

    const { data, error } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .select('id,name,email,role,company_id,company_name,company_logo_url')
      .eq('company_id', companyId)
      .order('name', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const users = (data ?? []).map((row: any) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      companyId: row.company_id,
      companyName: row.company_name ?? FIXED_COMPANY_NAME,
      companyLogoUrl: row.company_logo_url ?? null,
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

    const auth = await requireSuperAdminRole(req);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.status || 401 }
      );
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

    const companyId = await resolveFixedCompanyId();
    const branding = await getCompanyBranding(companyId);

    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role,
        company_id: companyId,
        company_name: branding.company_name,
        company_logo_url: branding.company_logo_url,
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
        company_name: branding.company_name,
        company_logo_url: branding.company_logo_url,
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
        companyName: branding.company_name,
        companyLogoUrl: branding.company_logo_url,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to create user.' },
      { status: 500 }
    );
  }
}