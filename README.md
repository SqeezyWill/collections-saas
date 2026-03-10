# Collections SaaS Starter

A Netlify-ready Next.js starter for building a collections and recovery software product that you can host for multiple client companies.

## What is included

### Phase 1
- Login screen
- Dashboard
- Accounts / cases page
- Collector performance
- Payments page
- PTP tracking page
- Reports page

### Phase 2
- Admin page for user roles and tenant setup
- Multi-role structure (super admin, admin, agent)
- CSV onboarding and export hooks (structure ready)
- Branding and white-label fields in tenant model

### Phase 3
- Multi-tenant data model foundation
- White-label expansion path
- SaaS-ready schema with company separation
- Deployable frontend for Netlify

## Tech stack
- Next.js 15
- TypeScript
- Tailwind CSS
- Supabase-ready backend integration

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`

## Netlify deployment
1. Push this project to GitHub.
2. Create a new site in Netlify from the repo.
3. Netlify will pick up `netlify.toml`.
4. Add the env vars from `.env.example` in Netlify site settings.
5. Deploy.

## Supabase setup
1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and add your values.
3. Run the SQL in `supabase/schema.sql` inside Supabase SQL editor.
4. Replace mock-data selectors with live Supabase queries page by page.

## Notes
- This starter ships with mock data so you can preview the interface immediately.
- It is not a full production backend yet. It is a strong commercial starter codebase and architecture that you can extend into a sellable SaaS.
- The included SQL schema gives you a practical production foundation.

## Suggested next build steps
1. Wire authentication to Supabase Auth
2. Add live CRUD for accounts, payments, PTPs, notes
3. Add CSV import workflow
4. Add audit logs and export actions
5. Add billing / subscription later if you want SaaS monetization
