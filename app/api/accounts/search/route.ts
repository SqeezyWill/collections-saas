import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const ALLOWED_FIELDS = new Set([
  'cfid',
  'phone',
  'account_no',
  'debtor_name',
  'identification',
  'customer_id',
]);

const FIXED_COMPANY_NAME = 'Pezesha';

function buildSearchClause(field: string, safeSearch: string) {
  switch (field) {
    case 'cfid':
      return `cfid.ilike.%${safeSearch}%`;
    case 'phone':
      return [
        `primary_phone.ilike.%${safeSearch}%`,
        `secondary_phone.ilike.%${safeSearch}%`,
        `tertiary_phone.ilike.%${safeSearch}%`,
        `contacts.ilike.%${safeSearch}%`,
      ].join(',');
    case 'account_no':
      return `account_no.ilike.%${safeSearch}%`;
    case 'debtor_name':
      return `debtor_name.ilike.%${safeSearch}%`;
    case 'identification':
      return `identification.ilike.%${safeSearch}%`;
    case 'customer_id':
      return `customer_id.ilike.%${safeSearch}%`;
    default:
      return `cfid.ilike.%${safeSearch}%`;
  }
}

async function resolveFixedCompanyId() {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin not configured.');
  }

  const lowered = FIXED_COMPANY_NAME.toLowerCase();

  const { data: companies, error } = await supabaseAdmin
    .from('companies')
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

  if (profileError || !profile) {
    return NextResponse.json({ error: 'User profile not found.' }, { status: 403 });
  }

  const companyId = profile.company_id || (await resolveFixedCompanyId());

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const field = (searchParams.get('field') || 'cfid').trim().toLowerCase();

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  if (!ALLOWED_FIELDS.has(field)) {
    return NextResponse.json({ error: 'Invalid search field.' }, { status: 400 });
  }

  const safeSearch = q.replace(/,/g, '').replace(/[%_]/g, '');
  const orClause = buildSearchClause(field, safeSearch);

  let query = supabaseAdmin
    .from('accounts')
    .select('id, cfid, debtor_name, account_no, primary_phone, contacts')
    .eq('company_id', companyId)
    .or(orClause)
    .limit(8);

  const role = String(profile.role || '').trim().toLowerCase();
  const collectorScope = String(user.user_metadata?.name || '').trim();

  if (role === 'agent' && collectorScope) {
    query = query.eq('collector_name', collectorScope);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}