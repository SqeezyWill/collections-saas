'use client';

import { useEffect, useRef, useState } from 'react';

type UploadJob = {
  id: string;
  job_type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string;
  total_rows: number;
  processed_rows: number;
  success_rows: number;
  failed_rows: number;
  error_message?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
};

type BackfillResult = {
  success: boolean;
  scannedWithProductCount?: number;
  eligibleWithoutActiveStrategyCount?: number;
  processedCount?: number;
  assignedCount?: number;
  failedCount?: number;
  error?: string;
};

function statusClasses(status: string) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'processing') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function UploadJobsPage() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const runningRef = useRef(false);

  async function refreshJobs() {
    try {
      const res = await fetch('/api/upload-jobs', { cache: 'no-store' });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load jobs.');
      }

      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setErrorMsg(null);
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to load jobs.');
    } finally {
      setLoading(false);
    }
  }

  async function runNextBatch() {
    if (runningRef.current) return;

    runningRef.current = true;
    setRunning(true);

    try {
      const res = await fetch('/api/accounts/product-upload/run', {
        method: 'POST',
        cache: 'no-store',
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to run next batch.');
      }

      await refreshJobs();
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to run next batch.');
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function runBackfillMissingStrategies() {
    setBackfillMessage(null);
    setErrorMsg(null);
    setBackfilling(true);

    try {
      const res = await fetch('/api/admin/account-strategy-backfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': process.env.NEXT_PUBLIC_ADMIN_API_KEY || '',
        },
        body: JSON.stringify({ limit: 500 }),
        cache: 'no-store',
      });

      const data = (await res.json().catch(() => null)) as BackfillResult | null;

      if (!res.ok) {
        throw new Error(data?.error || 'Failed to backfill missing strategies.');
      }

      setBackfillMessage(
        `Backfill complete. ` +
          `${Number(data?.assignedCount || 0)} assigned, ` +
          `${Number(data?.failedCount || 0)} failed, ` +
          `${Number(data?.eligibleWithoutActiveStrategyCount || 0)} eligible account(s) found.`
      );
    } catch (error: any) {
      setErrorMsg(error?.message || 'Failed to backfill missing strategies.');
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    refreshJobs();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(async () => {
      await refreshJobs();
    }, 5000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const hasActiveJobs = jobs.some(
      (job) => job.status === 'queued' || job.status === 'processing'
    );

    if (!hasActiveJobs) return;
    if (runningRef.current) return;

    const timeout = window.setTimeout(() => {
      runNextBatch();
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [jobs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Upload Jobs</h1>
          <p className="mt-1 text-slate-500">
            Monitor queued, processing, completed and failed upload jobs.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={refreshJobs}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={runNextBatch}
            disabled={running}
            className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {running ? 'Running...' : 'Run Next Batch'}
          </button>

          <button
            type="button"
            onClick={runBackfillMissingStrategies}
            disabled={backfilling}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {backfilling ? 'Backfilling...' : 'Backfill Missing Strategies'}
          </button>
        </div>
      </div>

      {errorMsg ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </p>
      ) : null}

      {backfillMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {backfillMessage}
        </p>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Loading jobs...</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm text-slate-500">No upload jobs found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 px-4 py-3">Job ID</th>
                  <th className="border-b border-slate-200 px-4 py-3">Type</th>
                  <th className="border-b border-slate-200 px-4 py-3">Status</th>
                  <th className="border-b border-slate-200 px-4 py-3">Total</th>
                  <th className="border-b border-slate-200 px-4 py-3">Processed</th>
                  <th className="border-b border-slate-200 px-4 py-3">Success</th>
                  <th className="border-b border-slate-200 px-4 py-3">Failed</th>
                  <th className="border-b border-slate-200 px-4 py-3">Created</th>
                  <th className="border-b border-slate-200 px-4 py-3">Started</th>
                  <th className="border-b border-slate-200 px-4 py-3">Finished</th>
                  <th className="border-b border-slate-200 px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50">
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {job.id}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {job.job_type}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${statusClasses(job.status)}`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {job.total_rows}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {job.processed_rows}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {job.success_rows}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {job.failed_rows}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {formatDateTime(job.created_at)}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {formatDateTime(job.started_at)}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">
                      {formatDateTime(job.finished_at)}
                    </td>
                    <td className="border-b border-slate-100 px-4 py-3 text-rose-700">
                      {job.error_message || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}