import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return NextResponse.json({ error: 'Missing bearer token.' }, { status: 401 });
  }

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role, company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile?.company_id) {
    return NextResponse.json({ error: 'User profile not found.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const safeSearch = q.replace(/,/g, '').replace(/[%_]/g, '');

  const { data, error } = await supabaseAdmin
    .from('accounts')
    .select('id, cfid, debtor_name, account_no, primary_phone, contacts')
    .eq('company_id', profile.company_id)
    .or(
      [
        `cfid.ilike.%${safeSearch}%`,
        `debtor_name.ilike.%${safeSearch}%`,
        `account_no.ilike.%${safeSearch}%`,
        `primary_phone.ilike.%${safeSearch}%`,
        `contacts.ilike.%${safeSearch}%`,
        `identification.ilike.%${safeSearch}%`,
        `customer_id.ilike.%${safeSearch}%`,
      ].join(',')
    )
    .limit(8);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}