import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const JOBS_TABLE = 'upload_jobs';
const JOB_ITEMS_TABLE = 'upload_job_items';

async function readJsonSafe(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const body = await readJsonSafe(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!rows.length) {
    return NextResponse.json({ error: 'rows array is required.' }, { status: 400 });
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from(JOBS_TABLE)
    .insert({
      company_id: COMPANY_ID,
      job_type: 'product_upload',
      status: 'queued',
      total_rows: rows.length,
      processed_rows: 0,
      success_rows: 0,
      failed_rows: 0,
      payload: {
        source: 'product_upload_page',
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id,status,total_rows,processed_rows,success_rows,failed_rows,created_at')
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { error: jobError?.message || 'Failed to create upload job.' },
      { status: 500 }
    );
  }

  const itemRows = rows.map((row: any, index: number) => ({
    job_id: job.id,
    row_number: index + 1,
    payload: row,
    status: 'queued',
    created_at: new Date().toISOString(),
  }));

  const { error: itemError } = await supabaseAdmin
    .from(JOB_ITEMS_TABLE)
    .insert(itemRows);

  if (itemError) {
    await supabaseAdmin
      .from(JOBS_TABLE)
      .update({
        status: 'failed',
        error_message: itemError.message,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return NextResponse.json({ error: itemError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    queued: true,
    message: 'Upload queued successfully.',
    job: {
      id: job.id,
      status: job.status,
      total_rows: job.total_rows,
      processed_rows: job.processed_rows,
      success_rows: job.success_rows,
      failed_rows: job.failed_rows,
      created_at: job.created_at,
    },
  });
}