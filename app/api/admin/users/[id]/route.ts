import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const PROFILE_TABLE = 'user_profiles';

function requireAdminKey(req: NextRequest) {
  const key = req.headers.get('x-admin-key');
  return Boolean(process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!requireAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  // If email is supplied, update Auth email too
  if (email) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
