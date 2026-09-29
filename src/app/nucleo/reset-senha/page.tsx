import { redirect } from 'next/navigation';

// O fluxo de redefinição de senha do painel agora é feito via Supabase Auth
// em /admin ("Esqueci minha senha") + /admin/redefinir-senha (link do e-mail).
export default function NucleoResetSenhaPage() {
  redirect('/admin');
}
