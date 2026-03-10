create extension if not exists pgcrypto;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null,
  theme_color text,
  logo_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists profiles (
  id uuid primary key,
  company_id uuid references companies(id) on delete cascade,
  full_name text not null,
  email text unique not null,
  role text not null check (role in ('super_admin','admin','agent')),
  created_at timestamptz default now()
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  debtor_name text not null,
  account_no text,
  product text not null check (product in ('ABSA LOAN','ABSA CREDIT CARD')),
  balance numeric(14,2) default 0,
  amount_paid numeric(14,2) default 0,
  dpd integer default 0,
  collector_name text,
  status text default 'Open',
  employment_status text default 'UNKNOWN',
  last_action_date date,
  last_pay_date date,
  created_at timestamptz default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  collector_name text,
  product text not null check (product in ('ABSA LOAN','ABSA CREDIT CARD')),
  amount numeric(14,2) not null,
  paid_on date not null,
  created_at timestamptz default now()
);

create table if not exists ptps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  collector_name text,
  product text not null check (product in ('ABSA LOAN','ABSA CREDIT CARD')),
  promised_amount numeric(14,2) default 0,
  promised_date date,
  status text not null default 'Promise To Pay' check (status in ('Promise To Pay','Kept','Broken')),
  created_at timestamptz default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  author_id uuid references profiles(id) on delete set null,
  body text not null,
  created_at timestamptz default now()
);

alter table companies enable row level security;
alter table profiles enable row level security;
alter table accounts enable row level security;
alter table payments enable row level security;
alter table ptps enable row level security;
alter table notes enable row level security;

create policy "company members can view companies" on companies for select using (true);
create policy "company members can view profiles" on profiles for select using (true);
create policy "company members can view accounts" on accounts for select using (true);
create policy "company members can view payments" on payments for select using (true);
create policy "company members can view ptps" on ptps for select using (true);
create policy "company members can view notes" on notes for select using (true);
