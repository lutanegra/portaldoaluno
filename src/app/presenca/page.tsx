import { redirect } from 'next/navigation';

/** A tela de registro avulso foi aposentada: a chamada diária vive no painel admin. */
export default function PresencaRedirect() {
  redirect('/admin');
}
