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

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

    const { id } = await context.params;
    const body = await req.json().catch(() => null);

    const name = String(body?.name || '').trim();
    const role = String(body?.role || '').trim();

    if (!name || !role) {
      return NextResponse.json(
        { error: 'Name and role are required.' },
        { status: 400 }
      );
    }

    const companyId = await resolveFixedCompanyId();
    const branding = await getCompanyBranding(companyId);

    const { data: existingProfile, error: existingError } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .select('id,email,company_id')
      .eq('id', id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existingProfile) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const update: Record<string, any> = {
      name,
      role,
      company_id: companyId,
      company_name: branding.company_name,
      company_logo_url: branding.company_logo_url,
    };

    const { data, error } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .update(update)
      .eq('id', id)
      .select('id,name,email,role,company_id,company_name,company_logo_url')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await supabaseAdmin.auth.admin.updateUserById(id, {
      user_metadata: {
        name,
        role,
        company_id: companyId,
        company_name: branding.company_name,
        company_logo_url: branding.company_logo_url,
      },
    });

    return NextResponse.json({
      user: {
        id: data?.id,
        name: data?.name,
        email: data?.email,
        role: data?.role,
        companyId: data?.company_id,
        companyName: data?.company_name ?? branding.company_name,
        companyLogoUrl: data?.company_logo_url ?? branding.company_logo_url,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to update user.' },
      { status: 500 }
    );
  }
}