import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

function requireAdminKey(req: NextRequest) {
  const key = req.headers.get('x-admin-key');
  return Boolean(process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY);
}

function makeTempPassword() {
  return `Temp#${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
}

export async function POST(
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

  // Fetch user email
  const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });

  const email = userRes.user?.email;
  if (!email) return NextResponse.json({ error: 'User email not found.' }, { status: 404 });

  // Preferred: recovery link
  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    if (error) throw error;

    const link = data.properties?.action_link ?? null;
    return NextResponse.json({ email, recoveryLink: link });
  } catch {
    // Fallback: set a temp password
    const tempPassword = makeTempPassword();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: tempPassword });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ email, tempPassword });
  }
}
