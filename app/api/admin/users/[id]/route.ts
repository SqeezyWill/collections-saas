import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireAdminRole } from '@/lib/server-auth';

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
    (companies || []).find(
      (company: any) => String(company.name || '').trim().toLowerCase() === lowered
    );

  if (!match?.id) {
    throw new Error('Selected company could not be resolved.');
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

    const auth = await requireAdminRole(req);
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

    let companyId = await resolveCompanyId(body?.companyId);

    if (auth.user.role === 'admin') {
      if (!auth.user.companyId) {
        return NextResponse.json({ error: 'Admin user has no company scope.' }, { status: 400 });
      }
      companyId = auth.user.companyId;
    }

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

    if (
      auth.user.role === 'admin' &&
      auth.user.companyId &&
      String(existingProfile.company_id || '') !== String(auth.user.companyId)
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
      },
    });

    return NextResponse.json({
      user: {
        id: data?.id,
        name: data?.name,
        email: data?.email,
        role: data?.role,
        companyId: data?.company_id,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to update user.' },
      { status: 500 }
    );
  }
}