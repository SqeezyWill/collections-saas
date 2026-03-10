'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useMemo, useState } from 'react';

type ParsedRow = Record<string, string>;

type PreviewRow = {
  raw: ParsedRow;
  __row: number;
  __matchType: 'id' | 'cfid' | 'none';
  __identifier: string | null;
  __productNameResolved: string | null;
  __productCodeResolved: string | null;
  __error: string | null;
};

const EXPECTED_HEADERS = ['ID', 'CFID', 'PRODUCT NAME', 'PRODUCT CATEGORY'] as const;

const ALLOWED_PRODUCT_CATEGORIES = [
  'asset_finance',
  'bnpl',
  'credit_card',
  'invoice_finance',
  'logbook_loan',
  'microfinance_loan',
  'mobile_loan',
  'mortgage',
] as const;

function cleanText(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function toCsv(rows: Array<Record<string, unknown>>) {
  return Papa.unparse(rows);
}

export default function ProductUploadPage() {
  const [fileName, setFileName] = useState('');
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const categorySet = useMemo(
    () => new Set(ALLOWED_PRODUCT_CATEGORIES.map((item) => item.toLowerCase())),
    []
  );

  function downloadTemplate() {
    const templateRows = ALLOWED_PRODUCT_CATEGORIES.map((category) => ({
      ID: '',
      CFID: '',
      'PRODUCT NAME': '',
      'PRODUCT CATEGORY': category,
    }));

    const csv = toCsv(templateRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'accounts-product-upload-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

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
            setErrorMessage(`The CSV is missing these headers: ${missing.join(', ')}`);
            setLoadingPreview(false);
            return;
          }

          const rows = (results.data || []) as ParsedRow[];
          const filteredRows = rows.filter((row) => {
            const id = cleanText(row['ID']);
            const cfid = cleanText(row['CFID']);
            const productName = cleanText(row['PRODUCT NAME']);
            const productCategory = cleanText(row['PRODUCT CATEGORY']);

            return Boolean(id || cfid || productName || productCategory);
          });

          if (!filteredRows.length) {
            setErrorMessage('No valid rows found in the CSV.');
            setLoadingPreview(false);
            return;
          }

          const preview: PreviewRow[] = filteredRows.map((row, index) => {
            const id = cleanText(row['ID']);
            const cfid = cleanText(row['CFID']);
            const productName = cleanText(row['PRODUCT NAME']);
            const productCategory = normalize(row['PRODUCT CATEGORY']);
            const matchType: PreviewRow['__matchType'] = id ? 'id' : cfid ? 'cfid' : 'none';
            const identifier = id || cfid || null;

            let rowError: string | null = null;

            if (!identifier) {
              rowError = 'Either ID or CFID is required.';
            } else if (!productCategory) {
              rowError = 'PRODUCT CATEGORY is required.';
            } else if (!categorySet.has(productCategory)) {
              rowError = `Invalid PRODUCT CATEGORY: ${productCategory}`;
            }

            return {
              raw: row,
              __row: index + 1,
              __matchType: matchType,
              __identifier: identifier,
              __productNameResolved: productName,
              __productCodeResolved: productCategory || null,
              __error: rowError,
            };
          });

          setPreviewRows(preview);

          const invalidCount = preview.filter((row) => row.__error).length;
          if (invalidCount > 0) {
            setErrorMessage(
              `Preview ready with ${invalidCount} invalid row(s). Fix them before upload.`
            );
          } else {
            setMessage(`Preview ready. ${preview.length} row(s) will be updated.`);
          }
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

    const invalidRows = previewRows.filter((row) => row.__error);
    if (invalidRows.length > 0) {
      setErrorMessage('Please fix invalid rows before uploading.');
      return;
    }

    setUploading(true);

    try {
      const rows = previewRows.map((row) => ({
        id: row.__matchType === 'id' ? row.__identifier : null,
        cfid: row.__matchType === 'cfid' ? row.__identifier : null,
        productName: row.__productNameResolved,
        productCode: row.__productCodeResolved,
      }));

      const response = await fetch('/api/accounts/product-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rows }),
      });

      const result = await response.json().catch(() => null);

      setUploading(false);

      if (!response.ok) {
        setErrorMessage(result?.error || 'Upload failed.');
        return;
      }

      const jobId = result?.job?.id || result?.jobId || null;

      if (jobId) {
        setMessage(
          `Upload queued successfully. Job ID: ${jobId}. You can continue working and monitor progress on Upload Jobs.`
        );
      } else {
        setMessage('Upload queued successfully. You can monitor progress on Upload Jobs.');
      }

      setPreviewRows([]);
      setFileName('');
    } catch (error: any) {
      setUploading(false);
      setErrorMessage(error?.message || 'Upload failed.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Product Upload</h1>
          <p className="mt-1 text-slate-500">
            Bulk update account product category without changing the current product-identification flow.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={downloadTemplate}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Download Product Template
          </button>

          <Link
            href="/accounts"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to Accounts
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            Use these headers exactly: <strong>ID</strong>, <strong>CFID</strong>,{' '}
            <strong>PRODUCT NAME</strong>, <strong>PRODUCT CATEGORY</strong>.
            <br />
            <strong>PRODUCT CATEGORY</strong> must be one of the allowed system categories below.
            <br />
            <strong>PRODUCT NAME</strong> is optional and can be the friendly product name such as
            <strong> Pezesha</strong>.
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">Allowed product categories</p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {ALLOWED_PRODUCT_CATEGORIES.map((category) => (
                <div
                  key={category}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  {category}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Upload Product CSV</label>
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
                      <th className="px-4 py-3">Row</th>
                      <th className="px-4 py-3">Match By</th>
                      <th className="px-4 py-3">Identifier</th>
                      <th className="px-4 py-3">Product Name</th>
                      <th className="px-4 py-3">Product Category</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 20).map((row) => (
                      <tr key={`${row.__row}-${row.__identifier || 'x'}`} className="border-t border-slate-200">
                        <td className="px-4 py-3">{row.__row}</td>
                        <td className="px-4 py-3 uppercase">{row.__matchType}</td>
                        <td className="px-4 py-3">{row.__identifier || '-'}</td>
                        <td className="px-4 py-3">{row.__productNameResolved || '-'}</td>
                        <td className="px-4 py-3">{row.__productCodeResolved || '-'}</td>
                        <td className="px-4 py-3">
                          {row.__error ? (
                            <span className="text-red-600">{row.__error}</span>
                          ) : (
                            <span className="text-emerald-700">Ready</span>
                          )}
                        </td>
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
                  {uploading ? 'Uploading...' : `Update ${previewRows.length} Accounts`}
                </button>

                <Link
                  href="/accounts"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}