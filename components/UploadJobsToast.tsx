'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

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
  updated_at?: string | null;
  finished_at?: string | null;
};

const DISMISS_KEY = 'upload_jobs_toast_dismissed_v3';

function statusClasses(status: string) {
  if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
  if (status === 'failed') return 'bg-rose-100 text-rose-700';
  if (status === 'processing') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function chooseBestJob(jobs: UploadJob[]) {
  if (!jobs.length) return null;

  const processing = jobs.find((job) => job.status === 'processing');
  if (processing) return processing;

  const queued = jobs.find((job) => job.status === 'queued');
  if (queued) return queued;

  const failed = jobs.find((job) => job.status === 'failed');
  if (failed) return failed;

  const completed = jobs.find((job) => job.status === 'completed');
  if (completed) return completed;

  return jobs[0];
}

function formatJobLabel(job: UploadJob) {
  if (job.status === 'completed') {
    return `Upload completed: ${job.success_rows} succeeded, ${job.failed_rows} failed`;
  }

  if (job.status === 'failed') {
    return `Upload failed${job.error_message ? `: ${job.error_message}` : ''}`;
  }

  if (job.status === 'processing') {
    return `Upload processing: ${job.processed_rows}/${job.total_rows} rows`;
  }

  return `Upload queued: ${job.total_rows} rows`;
}

function getDismissToken(job: UploadJob | null) {
  if (!job) return '';
  return `${job.id}:${job.status}`;
}

export function UploadJobsToast() {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const lastTokenRef = useRef('');

  const activeJob = useMemo(() => chooseBestJob(jobs), [jobs]);
  const activeToken = getDismissToken(activeJob);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DISMISS_KEY) || '';
      if (stored && stored === activeToken) {
        setDismissed(true);
      } else {
        setDismissed(false);
      }
    } catch {
      setDismissed(false);
    }
  }, [activeToken]);

  useEffect(() => {
    let mounted = true;
    let interval: number | undefined;

    async function refreshStatus() {
      try {
        const res = await fetch('/api/upload-jobs?active=1', {
          cache: 'no-store',
        });

        const data = await res.json().catch(() => null);

        if (!mounted) return;

        const nextJobs = Array.isArray(data?.jobs) ? data.jobs : [];
        setJobs(nextJobs);

        const nextActive = chooseBestJob(nextJobs);
        const nextToken = getDismissToken(nextActive);

        if (nextToken && nextToken !== lastTokenRef.current) {
          lastTokenRef.current = nextToken;

          try {
            const stored = window.localStorage.getItem(DISMISS_KEY) || '';
            setDismissed(stored === nextToken);
          } catch {
            setDismissed(false);
          }
        }
      } catch {
        if (!mounted) return;
      }
    }

    refreshStatus();
    interval = window.setInterval(refreshStatus, 5000);

    return () => {
      mounted = false;
      if (interval) window.clearInterval(interval);
    };
  }, []);

  if (!activeJob || dismissed) return null;

  return (
    <div className="fixed right-4 top-4 z-[100] w-full max-w-md">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">Upload Jobs</p>
              <span
                className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${statusClasses(activeJob.status)}`}
              >
                {activeJob.status}
              </span>
            </div>

            <p className="mt-2 text-sm text-slate-600">{formatJobLabel(activeJob)}</p>

            <p className="mt-2 text-xs text-slate-500">
              Job ID: <span className="font-medium">{activeJob.id}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              try {
                window.localStorage.setItem(DISMISS_KEY, activeToken);
              } catch {}
              setDismissed(true);
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
            aria-label="Close upload notification"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {activeJob.processed_rows}/{activeJob.total_rows} processed
          </div>

          <Link
            href="/upload-jobs"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View Jobs
          </Link>
        </div>
      </div>
    </div>
  );
}