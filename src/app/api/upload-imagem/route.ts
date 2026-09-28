// Upload de imagens hierarquia/organograma pelo servidor (o bucket é privado:
// o navegador não tem permissão de escrita direta).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';

const ALLOWED_PREFIXES = ['hierarquia/', 'organograma/'];

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('foto') as File | null;
    const folder = (formData.get('folder') as string | null) || 'hierarquia';

    if (!file) {
      return NextResponse.json({ error: 'Arquivo obrigatório.' }, { status: 400 });
    }
    if (!ALLOWED_PREFIXES.includes(`${folder}/`)) {
      return NextResponse.json({ error: 'Pasta não autorizada.' }, { status: 400 });
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Apenas imagens são aceitas.' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Imagem deve ter no máximo 5 MB.' }, { status: 400 });
    }

    const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const buf = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });

    if (uploadError) {
      console.error('upload-imagem error:', uploadError);
      return NextResponse.json({ error: 'Erro ao enviar a imagem.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, url: supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
