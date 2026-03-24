import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireSuperAdminRole } from '@/lib/server-auth';

function makeTempPassword() {
  return `Temp#${Math.random().toString(36).slice(2)}${Math.random()
    .toString(36)
    .slice(2)}`;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireSuperAdminRole(req);
    if ('error' in auth) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: auth.status || 401 }
      );
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
    }

    const { id: userId } = await ctx.params;
    const safeUserId = String(userId || '').trim();

    if (!safeUserId) {
      return NextResponse.json({ error: 'Missing user id.' }, { status: 400 });
    }

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.admin.getUserById(
      safeUserId
    );

    if (userErr) {
      return NextResponse.json({ error: userErr.message }, { status: 500 });
    }

    const email = userRes.user?.email;
    if (!email) {
      return NextResponse.json({ error: 'User email not found.' }, { status: 404 });
    }

    try {
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
      });

      if (error) throw error;

      const link = data.properties?.action_link ?? null;
      return NextResponse.json({ email, recoveryLink: link });
    } catch {
      const tempPassword = makeTempPassword();

      const { error } = await supabaseAdmin.auth.admin.updateUserById(safeUserId, {
        password: tempPassword,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ email, tempPassword });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to reset password.' },
      { status: 500 }
    );
  }
}