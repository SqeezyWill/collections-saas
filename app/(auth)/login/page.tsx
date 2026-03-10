import Link from 'next/link';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <img
              src="/credence-logo.png"
              alt="Credence logo"
              className="h-24 w-auto max-w-[220px] object-contain"
            />
          </div>

          <p className="text-sm font-medium uppercase tracking-[0.35em] text-slate-500">
            CREDCOLL@2026
          </p>

          <h1 className="mt-3 text-3xl font-bold text-slate-900">Sign in</h1>
          <p className="mt-2 text-sm text-slate-500">
            Enter your credentials to access the collections workspace.
          </p>
        </div>

        <form className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Username or Email
            </label>
            <input
              type="text"
              defaultValue="admin@example.com"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              type="password"
              defaultValue="password"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div className="pt-2">
            <Link
              href="/dashboard"
              className="block w-full rounded-xl bg-slate-900 px-4 py-3 text-center font-medium text-white transition hover:bg-slate-800"
            >
              Login
            </Link>
          </div>
        </form>
      </div>
    </main>
  );
}