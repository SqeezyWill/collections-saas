import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

const JOBS_TABLE = 'upload_jobs';
const JOB_ITEMS_TABLE = 'upload_job_items';
const BATCH_SIZE = 100;

function cleanText(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

async function recheckStrategyForAccount(accountId: string) {
  const adminKey = process.env.ADMIN_API_KEY || '';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '';

  if (!adminKey || !siteUrl) {
    return { ok: false, skipped: true, error: 'Missing ADMIN_API_KEY or site URL.' };
  }

  try {
    const res = await fetch(`${siteUrl}/api/admin/account-strategy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({
        accountId,
        source: 'auto',
        notes: 'Auto re-evaluated after product upload job.',
      }),
      cache: 'no-store',
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      return { ok: false, skipped: false, error: payload?.error || 'Strategy recheck failed.' };
    }

    return {
      ok: true,
      skipped: Boolean(payload?.skipped),
    };
  } catch (error: any) {
    return {
      ok: false,
      skipped: false,
      error: error?.message || 'Strategy recheck failed.',
    };
  }
}

export async function POST(_req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Supabase admin not configured.' }, { status: 500 });
  }

  const { data: job, error: jobError } = await supabaseAdmin
    .from(JOBS_TABLE)
    .select('*')
    .in('status', ['queued', 'processing'])
    .eq('job_type', 'product_upload')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  if (!job) {
    return NextResponse.json({ success: true, message: 'No queued jobs found.' });
  }

  if (job.status !== 'processing') {
    await supabaseAdmin
      .from(JOBS_TABLE)
      .update({
        status: 'processing',
        started_at: job.started_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);
  }

  const { data: items, error: itemsError } = await supabaseAdmin
    .from(JOB_ITEMS_TABLE)
    .select('*')
    .eq('job_id', job.id)
    .eq('status', 'queued')
    .order('row_number', { ascending: true })
    .limit(BATCH_SIZE);

  if (itemsError) {
    await supabaseAdmin
      .from(JOBS_TABLE)
      .update({
        status: 'failed',
        error_message: itemsError.message,
        updated_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const batch = items ?? [];

  if (batch.length === 0) {
    await supabaseAdmin
      .from(JOBS_TABLE)
      .update({
        status: 'completed',
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return NextResponse.json({ success: true, message: 'Job completed.', jobId: job.id });
  }

  let processedRows = Number(job.processed_rows || 0);
  let successRows = Number(job.success_rows || 0);
  let failedRows = Number(job.failed_rows || 0);

  for (const item of batch) {
    const row = item.payload || {};
    const id = cleanText(row.id);
    const cfid = cleanText(row.cfid);
    const productName = cleanText(row.productName);
    const productCode = cleanText(row.productCode);

    if (!id && !cfid) {
      await supabaseAdmin
        .from(JOB_ITEMS_TABLE)
        .update({
          status: 'failed',
          error_message: 'Missing ID/CFID.',
          processed_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      processedRows += 1;
      failedRows += 1;
      continue;
    }

    const payload: Record<string, string | null> = {
      product_code: productCode,
    };

    if (productName) {
      payload.product = productName;
    }

    let query = supabaseAdmin.from('accounts').update(payload);

    if (id) {
      query = query.eq('id', id);
    } else {
      query = query.eq('cfid', cfid);
    }

    const { data: updatedRows, error: updateError } = await query.select('id').limit(1);

    if (updateError || !updatedRows || updatedRows.length === 0) {
      await supabaseAdmin
        .from(JOB_ITEMS_TABLE)
        .update({
          status: 'failed',
          error_message: updateError?.message || 'Account not found.',
          processed_at: new Date().toISOString(),
        })
        .eq('id', item.id);

      processedRows += 1;
      failedRows += 1;
      continue;
    }

    const accountId = String(updatedRows[0].id);
    const recheck = await recheckStrategyForAccount(accountId);

    await supabaseAdmin
      .from(JOB_ITEMS_TABLE)
      .update({
        status: 'completed',
        error_message: recheck.ok ? null : recheck.error || null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    processedRows += 1;
    successRows += 1;
  }

  await supabaseAdmin
    .from(JOBS_TABLE)
    .update({
      processed_rows: processedRows,
      success_rows: successRows,
      failed_rows: failedRows,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  return NextResponse.json({
    success: true,
    jobId: job.id,
    processed_rows: processedRows,
    success_rows: successRows,
    failed_rows: failedRows,
    remaining_in_batch_cycle: Math.max(0, Number(job.total_rows || 0) - processedRows),
  });
}