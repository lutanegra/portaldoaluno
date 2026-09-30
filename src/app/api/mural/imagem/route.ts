// Entrega URLs assinadas de imagens do Mural (bucket privado) para o app do aluno.
// Segue o padrão do projeto: APIs de aluno confiam no student_id do app logado.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';

export async function GET(req: NextRequest) {
  const path = new URL(req.url).searchParams.get('path');
  if (!path || !path.startsWith('mural/')) {
    return NextResponse.json({ error: 'Caminho inválido.' }, { status: 400 });
  }

  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    if (!data?.signedUrl) return NextResponse.json({ error: 'Imagem não encontrada.' }, { status: 404 });
    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    console.error('mural/imagem error:', e);
    return NextResponse.json({ error: 'Erro ao gerar URL da imagem.' }, { status: 500 });
  }
}
