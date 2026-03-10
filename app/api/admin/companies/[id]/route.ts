import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const TABLE = 'companies';

function requireAdminKey(req: NextRequest) {
  const key = req.headers.get('x-admin-key');
  return Boolean(process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY);
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!requireAdminKey(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const name = body.name != null ? String(body.name).trim() : undefined;
  const code = body.code != null ? String(body.code).trim().toUpperCase() : undefined;
  const themeColor = body.themeColor != null ? String(body.themeColor).trim() : undefined;
  const logoUrl =
    body.logoUrl === null
      ? null
      : body.logoUrl != null
        ? String(body.logoUrl).trim()
        : undefined;

  const update: any = {};
  if (name !== undefined) update.name = name;
  if (code !== undefined) update.code = code;
  if (themeColor !== undefined) update.theme_color = themeColor;
  if (logoUrl !== undefined) update.logo_url = logoUrl;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields provided.' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    company: {
      id: data.id,
      name: data.name,
      code: data.code,
      themeColor: data.theme_color,
      logoUrl: data.logo_url ?? null,
      createdAt: data.created_at,
    },
  });
}
