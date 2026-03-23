import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireSuperAdminRole } from '@/lib/server-auth';

const PROFILE_TABLE = 'user_profiles';
const COMPANIES_TABLE = 'companies';
const FIXED_COMPANY_NAME = 'Pezesha';
const FIXED_COMPANY_LOGO_URL = '/logos/pezesha-logo.png';

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
    };

    const { data, error } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .update(update)
      .eq('id', id)
      .select('id,name,email,role,company_id')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await supabaseAdmin.auth.admin.updateUserById(id, {
      user_metadata: {
        name,
        role,
        company_id: companyId,
        company_name: FIXED_COMPANY_NAME,
        company_logo_url: FIXED_COMPANY_LOGO_URL,
      },
    });

    return NextResponse.json({
      user: {
        id: data?.id,
        name: data?.name,
        email: data?.email,
        role: data?.role,
        companyId: data?.company_id,
        companyName: FIXED_COMPANY_NAME,
        companyLogoUrl: FIXED_COMPANY_LOGO_URL,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to update user.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    const { data: existingProfile, error: existingError } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .select('id,email')
      .eq('id', id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existingProfile) {
      const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(id);

      if (authDeleteError) {
        return NextResponse.json({ error: 'User not found.' }, { status: 404 });
      }

      return NextResponse.json({ success: true });
    }

    const { error: profileDeleteError } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .delete()
      .eq('id', id);

    if (profileDeleteError) {
      return NextResponse.json({ error: profileDeleteError.message }, { status: 500 });
    }

    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(id);

    if (authDeleteError) {
      return NextResponse.json(
        {
          error: `Profile deleted, but failed to delete auth user: ${authDeleteError.message}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to delete user.' },
      { status: 500 }
    );
  }
}