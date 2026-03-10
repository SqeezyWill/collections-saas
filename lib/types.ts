export type Role = 'super_admin' | 'admin' | 'agent';

export type Company = {
  id: string;
  name: string;
  code: string;
  themeColor: string;
};

export type Account = {
  id: string;
  companyId: string;
  debtorName: string;
  accountNo: string;
  product: 'ABSA LOAN' | 'ABSA CREDIT CARD';
  balance: number;
  amountPaid: number;
  dpd: number;
  collector: string;
  status: 'Open' | 'PTP' | 'Paid' | 'Escalated';
  employmentStatus: 'EMPLOYED' | 'SELF-EMPLOYED' | 'UNEMPLOYED' | 'UNKNOWN';
  lastActionDate: string;
  lastPayDate: string;
};

export type Payment = {
  id: string;
  companyId: string;
  collector: string;
  product: 'ABSA LOAN' | 'ABSA CREDIT CARD';
  amount: number;
  paidOn: string;
};

export type PTP = {
  id: string;
  companyId: string;
  collector: string;
  product: 'ABSA LOAN' | 'ABSA CREDIT CARD';
  promisedAmount: number;
  promisedDate: string;
  status: 'Promise To Pay' | 'Kept' | 'Broken';
  createdAt: string;
};

export type UserProfile = {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId: string;
};
