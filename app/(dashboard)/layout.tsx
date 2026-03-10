'use client';

import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { UploadJobsToast } from '@/components/UploadJobsToast';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <UploadJobsToast />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}