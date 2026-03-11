import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRole } from '@/lib/server-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminRole(req);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();

    if (q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const safeSearch = q.replace(/,/g, '').replace(/[%_]/g, '');

    const { data, error } = await supabaseAdmin
      .from('accounts')
      .select('id, cfid, debtor_name, account_no, primary_phone, contacts')
      .eq('company_id', auth.profile.company_id)
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
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Unauthorized' },
      { status: 401 }
    );
  }
}