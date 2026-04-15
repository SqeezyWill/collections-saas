import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getRequestUserProfile } from '@/lib/server-auth';

const PROFILE_TABLE = 'user_profiles';
const COMPANIES_TABLE = 'companies';
const FIXED_COMPANY_NAME = 'Pezesha';
const FIXED_COMPANY_LOGO_URL = '/logos/pezesha-logo.png';
const ALLOWED_ROLES = new Set(['agent', 'admin', 'super_admin']);

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

async function resolveFixedCompanyId() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin is not configured.');
  }

  const { data, error } = await supabaseAdmin
    .from(COMPANIES_TABLE)
    .select('id,name,code')
    .or(`name.eq.${FIXED_COMPANY_NAME},code.eq.${FIXED_COMPANY_NAME}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.id) {
    throw new Error(`Fixed company "${FIXED_COMPANY_NAME}" could not be resolved.`);
  }

  return String(data.id);
}

async function getCompanyBranding(companyId: string) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin is not configured.');
  }

  const { data, error } = await supabaseAdmin
    .from(COMPANIES_TABLE)
    .select('id,name,logo_url')
    .eq('id', companyId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    company_name: (data as any)?.name ?? FIXED_COMPANY_NAME,
    company_logo_url: FIXED_COMPANY_LOGO_URL,
  };
}

export async function GET(req: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin is not configured.' }, { status: 500 });
    }

    const auth = await getRequestUserProfile(req);
if ('error' in auth) {
  return NextResponse.json(
    { error: auth.error || 'Unauthorized' },
    { status: auth.status || 401 }
  );
}

const normalizedRole = normalizeRole(auth.role);
if (normalizedRole !== 'super_admin' && normalizedRole !== 'admin') {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

    const companyId = await resolveFixedCompanyId();

    const { data, error } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .select('id,name,email,role,company_id')
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
      companyName: FIXED_COMPANY_NAME,
      companyLogoUrl: FIXED_COMPANY_LOGO_URL,
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

    const auth = await getRequestUserProfile(req);
if ('error' in auth) {
  return NextResponse.json(
    { error: auth.error || 'Unauthorized' },
    { status: auth.status || 401 }
  );
}

const normalizedRole = normalizeRole(auth.role);
if (normalizedRole !== 'super_admin') {
  return NextResponse.json({ error: 'Only super admins can create users.' }, { status: 401 });
}

    const body = await req.json().catch(() => null);

    const name = String(body?.name || '').trim();
    const email = normalizeEmail(body?.email);
    const role = normalizeRole(body?.role);
    const password = String(body?.password || '').trim();

    if (!name || !email || !role || !password) {
      return NextResponse.json(
        { error: 'Name, email, role, and password are required.' },
        { status: 400 }
      );
    }

    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Allowed roles are agent, admin, and super_admin.' },
        { status: 400 }
      );
    }

    const companyId = await resolveFixedCompanyId();
    const branding = await getCompanyBranding(companyId);

    const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
      .from(PROFILE_TABLE)
      .select('id,email')
      .eq('email', email)
      .maybeSingle();

    if (existingProfileError) {
      return NextResponse.json(
        { error: existingProfileError.message || 'Failed to validate existing profiles.' },
        { status: 500 }
      );
    }

    if (existingProfile?.id) {
      return NextResponse.json(
        {
          error:
            'A user profile with this email already exists. Edit the existing user or use a different email.',
        },
        { status: 400 }
      );
    }

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
      const message = String(createError?.message || 'Failed to create auth user.');

      return NextResponse.json(
        {
          error: message.includes('already been registered')
            ? 'A user with this email already exists in authentication. Use a different email or reset that user instead.'
            : message,
        },
        { status: 400 }
      );
    }

    const authUserId = createdUser.user.id;

    const { error: profileError } = await supabaseAdmin.from(PROFILE_TABLE).insert({
      id: authUserId,
      name,
      email,
      role,
      company_id: companyId,
    });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => null);

      return NextResponse.json(
        {
          error:
            profileError.message ||
            'Failed to save user profile. The auth user was rolled back automatically.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      user: {
        id: authUserId,
        name,
        email,
        role,
        companyId: companyId,
        companyName: FIXED_COMPANY_NAME,
        companyLogoUrl: FIXED_COMPANY_LOGO_URL,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to create user.' },
      { status: 500 }
    );
  }
}