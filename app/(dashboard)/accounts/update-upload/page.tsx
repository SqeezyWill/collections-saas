'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useMemo, useState } from 'react';

type ParsedRow = Record<string, string>;
type PreviewRow = ParsedRow & {
  __portfolioCategory: string;
  __productCode: string;
};

const EXPECTED_HEADERS = [
  'loan_id',
  'customer_id',
  'customer_names',
  'customer_phoneno',
  'national_id',
  'region',
  'loan_status',
  'loan_type',
  'score',
  'risk_segment',
  'installment_type',
  'funded_date',
  'due_date',
  'last_installment_date',
  'days_late_lastinstallment',
  'duration',
  'total_due',
  'repaid_amounts',
  'Outstanding_balance',
  'days_late',
  'officer',
  'PTP_offered',
  'PTP_due_date',
  'PTP_amount',
  'Reachability',
  'Collectability',
  'Officer Feedback 1',
  'Officer Feedback 2',
] as const;

function normalizeLoanType(value: unknown) {
  const raw = String(value || '').trim();
  return raw || null;
}

function normalizePortfolioCategory(value: unknown) {
  const loanType = String(value || '').trim().toUpperCase();
  if (!loanType) return '';
  return loanType === 'POCHI' ? 'POCHI' : 'Non-Pochi';
}

function normalizeStrategyProductCode() {
  return 'mobile_loan';
}

export default function UpdateUploadPage() {
  const [fileName, setFileName] = useState('');
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const previewCount = useMemo(() => previewRows.length, [previewRows]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setErrorMessage('');
    setMessage('');
    setPreviewRows([]);
    setMissingHeaders([]);

    if (!file) return;

    setFileName(file.name);
    setLoadingPreview(true);

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const headers = (results.meta.fields || []).map((header) => String(header).trim());
          const missing = EXPECTED_HEADERS.filter((header) => !headers.includes(header));
          setMissingHeaders(missing);

          if (missing.length > 0) {
            setErrorMessage(`The CSV is missing these standard headers: ${missing.join(', ')}`);
            setLoadingPreview(false);
            return;
          }

          const allRows = (results.data || []) as ParsedRow[];
          const filteredRows = allRows
            .filter((row) => String(row['loan_id'] || '').trim() !== '')
            .map((row) => ({
              ...row,
              __portfolioCategory: normalizePortfolioCategory(row['loan_type']),
              __productCode: normalizeStrategyProductCode(),
            }));

          if (!filteredRows.length) {
            setErrorMessage('No valid rows found. loan_id is required for updates.');
            setLoadingPreview(false);
            return;
          }

          setPreviewRows(filteredRows);
          setMessage(`Preview ready. ${filteredRows.length} row(s) will be updated.`);
        } catch (error: any) {
          setErrorMessage(error?.message || 'Failed to prepare preview.');
        } finally {
          setLoadingPreview(false);
        }
      },
      error: (error) => {
        setErrorMessage(error.message || 'Failed to parse CSV.');
        setLoadingPreview(false);
      },
    });
  }

  async function handleUpload() {
    setErrorMessage('');
    setMessage('');

    if (!previewRows.length) {
      setErrorMessage('Please upload a valid CSV first.');
      return;
    }

    setUploading(true);

    try {
      const response = await fetch('/api/accounts/update-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rows: previewRows }),
      });

      const result = await response.json().catch(() => null);

      setUploading(false);

      if (!response.ok) {
        setErrorMessage(result?.error || 'Update upload failed.');
        return;
      }

      const updatedCount = Number(result?.updatedCount || 0);
      const notFoundCount = Number(result?.notFoundCount || 0);
      const failedCount = Number(result?.failedCount || 0);
      const notesImportedCount = Number(result?.notesImportedCount || 0);

      setMessage(
        `Update upload complete. ${updatedCount} account(s) updated. ` +
          `Notes: ${notesImportedCount}. ` +
          `Not found: ${notFoundCount}. Failed: ${failedCount}.`
      );
      setPreviewRows([]);
      setFileName('');
    } catch (error: any) {
      setUploading(false);
      setErrorMessage(error?.message || 'Update upload failed.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Accounts Update Upload</h1>
          <p className="mt-1 text-slate-500">
            Upload an update file to refresh existing accounts. Matching is done by loan_id to
            account number. This page does not create new accounts.
          </p>
        </div>

        <a
          href="/accounts-import-template.csv"
          download
          className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download CSV Template
        </a>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Upload Update CSV</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700"
            />
            {fileName ? (
              <p className="mt-2 text-sm text-slate-500">Selected file: {fileName}</p>
            ) : null}
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <strong>Important:</strong> updates match existing accounts using <strong>loan_id</strong>{' '}
            against the stored account number. Rows without loan_id will be ignored.
          </div>

          {loadingPreview ? <p className="text-sm text-slate-500">Preparing preview...</p> : null}
          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

          {missingHeaders.length > 0 ? (
            <p className="text-sm text-red-600">Missing headers: {missingHeaders.join(', ')}</p>
          ) : null}

          {previewRows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Loan ID</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Loan Type</th>
                      <th className="px-4 py-3">Portfolio Category</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Officer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 10).map((row) => (
                      <tr
                        key={`${row['loan_id']}-${row['customer_id'] || row['customer_names']}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">{row['loan_id'] || '-'}</td>
                        <td className="px-4 py-3">{row['customer_names'] || '-'}</td>
                        <td className="px-4 py-3">{normalizeLoanType(row['loan_type']) || '-'}</td>
                        <td className="px-4 py-3">{row.__portfolioCategory || '-'}</td>
                        <td className="px-4 py-3">{row['customer_phoneno'] || '-'}</td>
                        <td className="px-4 py-3">{row['officer'] || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={uploading}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploading ? 'Uploading...' : `Update ${previewCount} Accounts`}
                </button>

                <Link
                  href="/accounts"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Back to Accounts
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}