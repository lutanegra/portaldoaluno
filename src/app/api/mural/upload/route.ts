// Upload de cartazes do Mural para o bucket privado (photos/mural/...).
// Requer sessão de painel (owner/admin geral/admin de núcleo).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';

export async function POST(req: NextRequest) {
  try {
    const sess = readPanelSession(req);
    if (!sess) return NextResponse.json({ error: 'Sessão do painel expirada. Entre novamente.' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Arquivo obrigatório.' }, { status: 400 });
    if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Apenas imagens são aceitas.' }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Imagem deve ter no máximo 8 MB.' }, { status: 400 });

    const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const path = `mural/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const buf = await file.arrayBuffer();
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type || 'image/jpeg', upsert: false });

    if (error) {
      console.error('mural/upload error:', error);
      return NextResponse.json({ error: 'Falha ao enviar a imagem.' }, { status: 500 });
    }

    return NextResponse.json({ path });
  } catch (e) {
    console.error('mural/upload error:', e);
    return NextResponse.json({ error: 'Erro inesperado no upload.' }, { status: 500 });
  }
}
