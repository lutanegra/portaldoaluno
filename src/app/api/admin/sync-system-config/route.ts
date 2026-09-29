import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Sincroniza a config do painel (storage JSON) com a tabela system_config,
// que é a fonte lida pelas páginas públicas (verificar, documentos, etc).
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const CAMPOS: Array<{ de: string; para: string }> = [
  { de: 'system_name', para: 'system_name' },
  { de: 'organization_name', para: 'organization_name' },
  { de: 'organization_short', para: 'organization_short' },
  { de: 'id_prefix', para: 'id_prefix' },
  { de: 'card_title', para: 'card_title' },
  { de: 'card_subtitle', para: 'card_subtitle' },
  { de: 'signature_name', para: 'signature_name' },
  { de: 'signature_role', para: 'signature_role' },
  { de: 'contact_email', para: 'contact_email' },
  { de: 'contact_phone', para: 'contact_phone' },
  { de: 'contact_whatsapp', para: 'contact_whatsapp' },
  { de: 'website_url', para: 'website_url' },
  { de: 'instagram_url', para: 'instagram_url' },
  { de: 'facebook_url', para: 'facebook_url' },
  { de: 'youtube_url', para: 'youtube_url' },
  { de: 'footer_text', para: 'footer_text' },
  { de: 'logo_url', para: 'logo_url' },
  { de: 'signature_image_url', para: 'signature_image_url' },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const config = body.config || {};
    const row: Record<string, string | Date> = { updated_at: new Date().toISOString() };
    for (const { de, para } of CAMPOS) {
      if (typeof config[de] === 'string') row[para] = config[de];
    }
    const { error } = await supabase.from('system_config').update(row).eq('id', 1);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
