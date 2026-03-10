import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function UpdateContactEmployerPage({ params }: PageProps) {
  const { id } = await params;

  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Update Contact & Employer</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const { data: account, error } = await supabase
    .from('accounts')
    .select(
      'id, debtor_name, primary_phone, secondary_phone, tertiary_phone, employer_name, employer_details'
    )
    .eq('id', id)
    .single();

  if (error || !account) {
    notFound();
  }

  async function saveDetails(formData: FormData) {
    'use server';

    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    const primaryPhone = String(formData.get('primaryPhone') || '').trim();
    const secondaryPhone = String(formData.get('secondaryPhone') || '').trim();
    const tertiaryPhone = String(formData.get('tertiaryPhone') || '').trim();
    const employerName = String(formData.get('employerName') || '').trim();
    const employerDetails = String(formData.get('employerDetails') || '').trim();

    const { error: updateError } = await supabase
      .from('accounts')
      .update({
        primary_phone: primaryPhone || null,
        secondary_phone: secondaryPhone || null,
        tertiary_phone: tertiaryPhone || null,
        employer_name: employerName || null,
        employer_details: employerDetails || null,
      })
      .eq('id', id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    redirect(`/accounts/${id}`);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href={`/accounts/${id}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account Workspace
        </Link>
        <h1 className="text-3xl font-semibold text-slate-900">Update Contact & Employer</h1>
        <p className="mt-1 text-slate-500">
          Update client phone numbers and employer details for {account.debtor_name}.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <form action={saveDetails} className="space-y-8">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Phone Numbers</h2>
            <p className="mt-1 text-sm text-slate-500">
              Save the numbers in the correct slots so SMS uses only the numbers linked to this account.
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Primary Phone
                </label>
                <input
                  name="primaryPhone"
                  type="text"
                  defaultValue={account.primary_phone || ''}
                  placeholder="Enter primary phone"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Secondary Phone
                </label>
                <input
                  name="secondaryPhone"
                  type="text"
                  defaultValue={account.secondary_phone || ''}
                  placeholder="Enter secondary phone"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Tertiary Phone
                </label>
                <input
                  name="tertiaryPhone"
                  type="text"
                  defaultValue={account.tertiary_phone || ''}
                  placeholder="Enter tertiary phone"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-slate-900">Employer Details</h2>
            <div className="mt-5 grid gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Employer Name
                </label>
                <input
                  name="employerName"
                  type="text"
                  defaultValue={account.employer_name || ''}
                  placeholder="Enter employer name"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Employer Details
                </label>
                <textarea
                  name="employerDetails"
                  rows={7}
                  defaultValue={account.employer_details || ''}
                  placeholder="Enter updated employer details, workplace notes, location, role, tenure or any relevant verified information..."
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={`/accounts/${id}`}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save Contact & Employer Details
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}