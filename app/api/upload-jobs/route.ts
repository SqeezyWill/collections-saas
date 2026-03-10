import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const JOBS_TABLE = 'upload_jobs';

export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const url = new URL(req.url);
  const activeOnly = url.searchParams.get('active')?.trim() === '1';

  let query = supabaseAdmin
    .from(JOBS_TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (activeOnly) {
    query = query.in('status', ['queued', 'processing', 'completed', 'failed']).limit(5);
  } else {
    query = query.limit(50);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data ?? [] });
}