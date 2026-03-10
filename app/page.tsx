import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 max-w-3xl">
          <span className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-700">
            Multi-tenant collections platform starter
          </span>
          <h1 className="mt-6 text-5xl font-bold tracking-tight text-slate-900">
            Build, host, and resell your own collections & recovery system.
          </h1>
          <p className="mt-5 text-lg text-slate-600">
            This starter includes phase 1 to 3 foundations: dashboards, case management, collector performance,
            payments, PTP tracking, multi-company support, role-based access, white-label hooks, and Supabase-ready schema.
          </p>
          <div className="mt-8 flex gap-4">
            <Link href="/login" className="rounded-xl bg-brand-600 px-5 py-3 font-medium text-white hover:bg-brand-700">
              Open demo app
            </Link>
            <a href="#features" className="rounded-xl border border-slate-300 px-5 py-3 font-medium text-slate-700 hover:bg-slate-100">
              Explore features
            </a>
          </div>
        </div>

        <div id="features" className="grid gap-6 md:grid-cols-3">
          {[
            ['Phase 1', 'Dashboard, accounts, payments, PTPs, collector performance, reports'],
            ['Phase 2', 'Admin roles, branding, CSV onboarding, exports, notes and follow-ups'],
            ['Phase 3', 'Multi-tenancy, white-label structure, subscription-ready foundations'],
          ].map(([title, copy]) => (
            <div key={title} className="card p-6">
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="mt-3 text-slate-600">{copy}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
