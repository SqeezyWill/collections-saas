import { Account, Company, Payment, PTP, UserProfile } from './types';

export const companies: Company[] = [
  { id: 'credence', name: 'Credence Recovery Group', code: 'CRG', themeColor: '#4338ca' },
  { id: 'acorn', name: 'Acorn BPO', code: 'ACN', themeColor: '#0f766e' },
];

export const users: UserProfile[] = [
  { id: 'u1', name: 'Sqee', email: 'admin@example.com', role: 'super_admin', companyId: 'credence' },
  { id: 'u2', name: 'Salome Wambui', email: 'salome@example.com', role: 'agent', companyId: 'credence' },
  { id: 'u3', name: 'Teresia Wambui', email: 'teresia@example.com', role: 'agent', companyId: 'credence' },
  { id: 'u4', name: 'Wilberforce Ali Shikoli', email: 'wilberforce@example.com', role: 'agent', companyId: 'credence' },
];

export const accounts: Account[] = [
  { id: 'a1', companyId: 'credence', debtorName: 'Peter Shikuku Amisi', accountNo: '2031651541', product: 'ABSA LOAN', balance: 4225709, amountPaid: 0, dpd: 375, collector: 'Wilberforce Ali Shikoli', status: 'Open', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-06', lastPayDate: '2026-02-06' },
  { id: 'a2', companyId: 'credence', debtorName: 'Joshua Musyimi Makau', accountNo: '2038678860', product: 'ABSA CREDIT CARD', balance: 2946491, amountPaid: 6000, dpd: 130, collector: 'Salome Wambui', status: 'PTP', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-12', lastPayDate: '2025-12-05' },
  { id: 'a3', companyId: 'credence', debtorName: 'Patrick Kutore', accountNo: '2021728406', product: 'ABSA LOAN', balance: 2594942, amountPaid: 150, dpd: 252, collector: 'Wilberforce Ali Shikoli', status: 'Open', employmentStatus: 'UNKNOWN', lastActionDate: '2026-02-23', lastPayDate: '2025-09-11' },
  { id: 'a4', companyId: 'credence', debtorName: 'Mercy Njeri', accountNo: '200001', product: 'ABSA LOAN', balance: 17296411, amountPaid: 47511, dpd: 64, collector: 'Salome Wambui', status: 'Open', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-15', lastPayDate: '2026-02-15' },
  { id: 'a5', companyId: 'credence', debtorName: 'John Mwangi', accountNo: '200002', product: 'ABSA CREDIT CARD', balance: 1092262, amountPaid: 25001, dpd: 42, collector: 'Salome Wambui', status: 'Paid', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-17', lastPayDate: '2026-02-17' },
  { id: 'a6', companyId: 'credence', debtorName: 'Jane Kendi', accountNo: '200003', product: 'ABSA LOAN', balance: 19080187, amountPaid: 186000, dpd: 55, collector: 'Teresia Wambui', status: 'PTP', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-16', lastPayDate: '2026-02-16' },
  { id: 'a7', companyId: 'credence', debtorName: 'Paul Kimani', accountNo: '200004', product: 'ABSA CREDIT CARD', balance: 1585298, amountPaid: 38532, dpd: 32, collector: 'Teresia Wambui', status: 'Open', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-17', lastPayDate: '2026-02-17' },
  { id: 'a8', companyId: 'credence', debtorName: 'Ali Hassan', accountNo: '200005', product: 'ABSA LOAN', balance: 24594394, amountPaid: 173550, dpd: 48, collector: 'Wilberforce Ali Shikoli', status: 'PTP', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-20', lastPayDate: '2026-02-20' },
  { id: 'a9', companyId: 'credence', debtorName: 'Rose Atieno', accountNo: '200006', product: 'ABSA CREDIT CARD', balance: 1489660, amountPaid: 22402, dpd: 21, collector: 'Wilberforce Ali Shikoli', status: 'Open', employmentStatus: 'EMPLOYED', lastActionDate: '2026-02-20', lastPayDate: '2026-02-20' },
  { id: 'a10', companyId: 'credence', debtorName: 'Nixon Kariuki', accountNo: '200007', product: 'ABSA LOAN', balance: 1089211, amountPaid: 0, dpd: 77, collector: 'Salome Wambui', status: 'PTP', employmentStatus: 'SELF-EMPLOYED', lastActionDate: '2026-02-11', lastPayDate: '2026-02-01' },
  { id: 'a11', companyId: 'credence', debtorName: 'Deborah Wairimu', accountNo: '200008', product: 'ABSA CREDIT CARD', balance: 131525, amountPaid: 0, dpd: 19, collector: 'Salome Wambui', status: 'Open', employmentStatus: 'SELF-EMPLOYED', lastActionDate: '2026-02-11', lastPayDate: '2026-02-01' },
  { id: 'a12', companyId: 'acorn', debtorName: 'Tenant Demo', accountNo: '300001', product: 'ABSA LOAN', balance: 980000, amountPaid: 10000, dpd: 20, collector: 'Demo Agent', status: 'Open', employmentStatus: 'UNKNOWN', lastActionDate: '2026-02-18', lastPayDate: '2026-02-18' },
];

export const payments: Payment[] = [
  { id: 'p1', companyId: 'credence', collector: 'Salome Wambui', product: 'ABSA LOAN', amount: 47511, paidOn: '2026-02-15' },
  { id: 'p2', companyId: 'credence', collector: 'Salome Wambui', product: 'ABSA CREDIT CARD', amount: 25001, paidOn: '2026-02-17' },
  { id: 'p3', companyId: 'credence', collector: 'Teresia Wambui', product: 'ABSA LOAN', amount: 186000, paidOn: '2026-02-16' },
  { id: 'p4', companyId: 'credence', collector: 'Teresia Wambui', product: 'ABSA CREDIT CARD', amount: 38532, paidOn: '2026-02-17' },
  { id: 'p5', companyId: 'credence', collector: 'Wilberforce Ali Shikoli', product: 'ABSA LOAN', amount: 173550, paidOn: '2026-02-20' },
  { id: 'p6', companyId: 'credence', collector: 'Wilberforce Ali Shikoli', product: 'ABSA CREDIT CARD', amount: 22402, paidOn: '2026-02-20' },
];

export const ptps: PTP[] = [
  { id: 'ptp1', companyId: 'credence', collector: 'Salome Wambui', product: 'ABSA LOAN', promisedAmount: 50000, promisedDate: '2026-03-05', status: 'Promise To Pay', createdAt: '2026-02-15' },
  { id: 'ptp2', companyId: 'credence', collector: 'Teresia Wambui', product: 'ABSA LOAN', promisedAmount: 120000, promisedDate: '2026-03-03', status: 'Promise To Pay', createdAt: '2026-02-16' },
  { id: 'ptp3', companyId: 'credence', collector: 'Wilberforce Ali Shikoli', product: 'ABSA LOAN', promisedAmount: 180000, promisedDate: '2026-03-08', status: 'Promise To Pay', createdAt: '2026-02-20' },
  { id: 'ptp4', companyId: 'credence', collector: 'Salome Wambui', product: 'ABSA CREDIT CARD', promisedAmount: 25000, promisedDate: '2026-03-06', status: 'Promise To Pay', createdAt: '2026-02-18' },
];
