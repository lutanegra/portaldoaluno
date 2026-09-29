import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Portão único de administração: /admin atende Owner, Admin Geral e admins de núcleo.
// A página do núcleo agora apenas encaminha para lá.
export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/admin?nucleo=${encodeURIComponent(slug)}`);
}
