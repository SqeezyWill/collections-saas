import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Collections SaaS Starter',
  description: 'Netlify-ready collections and recovery SaaS starter',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
