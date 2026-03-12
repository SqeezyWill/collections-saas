import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireSuperAdminRole } from '@/lib/server-auth';

const PROFILE_TABLE = 'user_profiles';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdminRole(req);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const { id: userId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const name = body.name != null ? String(body.name).trim() : undefined;
  const email = body.email != null ? String(body.email).trim().toLowerCase() : undefined;
  const role = body.role != null ? String(body.role).trim() : undefined;
  const companyId = body.companyId != null ? String(body.companyId).trim() : undefined;

  if (!name && !email && !role && !companyId) {
    return NextResponse.json({ error: 'No fields provided.' }, { status: 400 });
  }

  if (email) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const update: Record<string, any> = {};
  if (name) update.name = name;
  if (email) update.email = email;
  if (role) update.role = role;
  if (companyId) update.company_id = companyId;

  const { data, error } = await supabaseAdmin
    .from(PROFILE_TABLE)
    .update(update)
    .eq('id', userId)
    .select('id,name,email,role,company_id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    user: {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
      companyId: data.company_id,
    },
  });
}