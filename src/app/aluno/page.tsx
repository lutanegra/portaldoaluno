'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Carteirinha from '@/components/Carteirinha';
import PhotoEditor from '@/components/PhotoEditor';
import { graduacoes as GRADUACOES_ALL, nomenclaturaGraduacao, getCordaColors } from '@/lib/graduacoes';
import {
  IconHome, IconIdCard, IconMapPin, IconWallet, IconMedal, IconPencil, IconChart,
  IconCamera, IconFolder, IconNote, IconMusic, IconGear, IconDoc, IconMenu, IconX,
  IconLogout, IconUser, IconChevron, IconBell, IconImage, IconEye, IconTrend,
  IconFlame, IconStar, IconWarn, IconClock, IconBerimbau,
  IconCheck, IconInfo, IconLock, IconTrash, IconBag, IconLink, IconRefresh, IconPrinter,
  IconUsers,
} from '@/components/icons';
import { pendenciasAluno, resumoPendencias, isValidCPF, isValidRG, cpfDigits, type StudentDocsLike } from '@/lib/studentCompliance';
import { idadeEm, menorDeIdade } from '@/lib/idade';
import AppFooter from '@/components/AppFooter';
import PerfilGuardiaoCard from '@/components/PerfilGuardiaoCard';
import NotificationsCenter from '@/components/NotificationsCenter';
import AssinaturaCanvas from '@/components/AssinaturaCanvas';
import { useSystemConfig } from '@/hooks/useSystemConfig';
import FrequenciaCard from './FrequenciaCard';

/** Título de seção com ícone SVG à esquerda (substitui os h2 com emoji). */
function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.06rem', fontWeight: 800, color: '#f5f5f4', letterSpacing: '-0.01em' }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 33, height: 33, borderRadius: 11, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.30), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.32)', color: '#FF9200', flexShrink: 0, boxShadow: '0 0 16px rgba(255,146,0,0.18)' }}>
        {icon}
      </span>
      {children}
    </h2>
  );
}

/** Rótulo pequeno de grupo (Mural, Eventos...) com ícone e linha em degradê. */
function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ display: 'flex', color: '#FF9200' }}>{icon}</span>
      <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{children}</span>
      <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(255,146,0,0.25), rgba(255,255,255,0.06))' }} />
    </div>
  );
}

// Ícone SVG de cada aba do app (substitui os emojis antigos)
const TAB_ICONS: Record<string, (p: { size?: number; style?: React.CSSProperties }) => React.JSX.Element> = {
  dashboard: IconHome,
  dados: IconPencil,
  termo: IconDoc,
  evolucao: IconChart,
  carteirinha: IconIdCard,
  presenca: IconMapPin,
  financeiro: IconWallet,
  graduacao: IconMedal,
  fotos: IconCamera,
  docs: IconFolder,
  justificativas: IconNote,
  playlist: IconMusic,
  conta: IconGear,
};

type MuralItem = {
  id: string;
  tipo: 'cartaz' | 'aviso';
  titulo: string;
  texto?: string;
  imagem_path?: string;
  autor: string;
  autor_login: string;
  nucleo?: string;
  created_at: string;
};

type Student = {
  id: string;
  nome_completo: string;
  apelido?: string;
  nome_social?: string;
  cpf?: string;
  identidade?: string;
  numeracao_unica?: string;
  data_nascimento?: string;
  telefone?: string;
  email?: string;
  nucleo?: string;
  graduacao?: string;
  tipo_graduacao?: string;
  foto_url?: string;
  sexo?: string;
  inscricao_numero?: number;
  nome_pai?: string;
  nome_mae?: string;
  nome_responsavel?: string;
  cpf_responsavel?: string;
  menor_de_idade?: boolean;
  desenvolvimento_atipico?: string[];
  [key: string]: unknown;
};

type Justificativa = {
  id: string;
  data_falta: string;
  motivo: string;
  status: 'pendente' | 'aprovado' | 'recusado';
  resposta_mestre?: string;
  created_at: string;
};

type RegistroGraduacao = {
  id: string;
  data_graduacao: string;
  graduacao_recebida: string;
  evento: string;
  professor_responsavel: string;
  observacoes?: string;
  criado_em: string;
};

type Tab = 'dashboard' | 'carteirinha' | 'presenca' | 'financeiro' | 'graduacao' | 'justificativas' | 'fotos' | 'playlist' | 'conta' | 'evolucao' | 'dados' | 'termo' | 'docs';

// Cores de graduação adaptadas ao tema escuro: fundo translúcido, texto claro
const GRAD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Cru': { bg: 'rgba(229,231,235,0.10)', text: '#e5e7eb', border: '#e5e7eb' },
  'Amarela': { bg: 'rgba(250,204,21,0.10)', text: '#fde047', border: '#fde047' },
  'Laranja': { bg: 'rgba(255,146,0,0.12)', text: '#fb923c', border: '#fb923c' },
  'Azul': { bg: 'rgba(59,130,246,0.10)', text: '#93c5fd', border: '#60a5fa' },
  'Vermelha': { bg: 'rgba(239,68,68,0.10)', text: '#fca5a5', border: '#f87171' },
  'Verde': { bg: 'rgba(34,197,94,0.10)', text: '#86efac', border: '#4ade80' },
  'Roxa': { bg: 'rgba(192,132,252,0.10)', text: '#d8b4fe', border: '#c084fc' },
  'Marrom': { bg: 'rgba(217,119,6,0.12)', text: '#fbbf24', border: '#d97706' },
  'Preta': { bg: 'rgba(120,120,120,0.14)', text: '#e5e7eb', border: '#9ca3af' },
};

function getGradColor(grad: string) {
  return GRAD_COLORS[grad] || { bg: 'rgba(255,146,0,0.10)', text: '#fb923c', border: '#fb923c' };
}

export default function AlunoPage() {
  const { config: sysConfig } = useSystemConfig();
  const [session, setSession] = useState<{ student_id: string; username: string } | null>(null);
  // Contexto de perfil: o próprio ou um tutelado (troca não muda a identidade logada)
  const [perfis, setPerfis] = useState<{ student_id: string; nome_completo: string; foto_url: string | null; tipo: 'proprio' | 'tutelado' | 'responsavel' }[]>([]);
  const [perfilAtivo, setPerfilAtivo] = useState<string>('');
  const [perfilLoading, setPerfilLoading] = useState(false);
  const perfilAtivoInfo = perfis.find(p => p.student_id === perfilAtivo) || null;
  // Dependentes do responsável (conta só-responsável) — painel no dashboard
  const [dependentes, setDependentes] = useState<{ student_id: string; nome_completo: string; foto_url: string | null; nucleo: string | null; idade: number | null; status_vinculo: string }[]>([]);
  const acessandoComoTutelado = !!perfilAtivoInfo && perfilAtivoInfo.tipo === 'tutelado';
  // Alvo das ações com escopo de perfil: com o perfil de um dependente aberto,
  // salvar dados, termo, presença etc. age sobre ELE — o servidor valida o
  // vínculo de responsabilidade (resolverAtor). A identidade logada (session)
  // continua sendo usada só para senha/conta/updates de acesso.
  const alvoPerfil = perfilAtivoInfo ? perfilAtivoInfo.student_id : session?.student_id ?? '';
  const [student, setStudent] = useState<Student | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(true);
  const [studentLoaded, setStudentLoaded] = useState(false);
  const [alunoInscricaoNum, setAlunoInscricaoNum] = useState<number | null>(null);
  const carteirinhaRef = useRef<HTMLDivElement>(null);

  // ── Login ──────────────────────────────────────────────────────────────────
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);

  // Sidebar (menu hambúrguer)
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Mural de avisos ─────────────────────────────────────────────────────────
  const [muralItems, setMuralItems] = useState<MuralItem[]>([]);
  const [muralLoading, setMuralLoading] = useState(false);
  const [muralUrls, setMuralUrls] = useState<Record<string, string>>({});
  const muralLoadedRef = useRef(false);
  // Perfil só-responsável (conta_tipo='responsavel' e sem perfil de aluno ativo)
  const [contaTipo, setContaTipo] = useState<'aluno' | 'responsavel' | null>(null);

  // ── Register ──────────────────────────────────────────────────────────────
  const [showRegister, setShowRegister] = useState(false);
  // Tipo de conta: null = tela de escolha; 'aluno' fluxo normal; 'responsavel' conta de responsável
  const [registerTipo, setRegisterTipo] = useState<null | 'aluno' | 'responsavel'>(null);
  // Responsável também é aluno? (só quando registerTipo === 'responsavel')
  const [respTambemAluno, setRespTambemAluno] = useState<null | boolean>(null);
  const [respForm, setRespForm] = useState({ nome_completo: '', cpf: '', data_nascimento: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [respError, setRespError] = useState('');
  const [respSuccess, setRespSuccess] = useState('');
  const [respLoading, setRespLoading] = useState(false);
  const [registerForm, setRegisterForm] = useState({ cpf_or_doc: '', username: '', email: '', password: '', confirmPassword: '', phone: '', data_nascimento: '' });
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState('');
  const [registerLoading, setRegisterLoading] = useState(false);

  // ── Forgot Password ───────────────────────────────────────────────────────
  const [showForgot, setShowForgot] = useState(false);
  const [forgotInput, setForgotInput] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotStudentId, setForgotStudentId] = useState('');
  const [forgotStep, setForgotStep] = useState<'lookup' | 'reset' | 'done'>('lookup');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [, setForgotCodeSent] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetOtp, setResetOtp] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  // ── Nucleos Dinamicos ────────────────────────────────────────────────────
  const [dynamicNucleos, setDynamicNucleos] = useState<Array<{ id: string; nome: string; slug: string; ativo: boolean }>>([]);

  // ── Presenca ──────────────────────────────────────────────────────────────
  const [presencaMsg, setPresencaMsg] = useState('');
  const [presencaLoading, setPresencaLoading] = useState(false);
  const [presencaStatus, setPresencaStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // ── Justificativas ────────────────────────────────────────────────────────
  const [justificativas, setJustificativas] = useState<Justificativa[]>([]);
  const [justForm, setJustForm] = useState({ data_falta: '', motivo: '' });
  const [justLoading, setJustLoading] = useState(false);
  const [justMsg, setJustMsg] = useState('');
  const [justMsgType, setJustMsgType] = useState<'success' | 'error'>('success');

  // ── Graduação ─────────────────────────────────────────────────────────────
  const [historico, setHistorico] = useState<RegistroGraduacao[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [eventos, setEventos] = useState<any[]>([]);
  const [eventosLoading, setEventosLoading] = useState(false);

  // ── Documentos Pessoais ───────────────────────────────────────────────────
  const [docsItems, setDocsItems] = useState<{ name: string; displayName: string; url: string; icon: string; size: string; sizeBytes: number; created_at: string; ext: string }[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsMsg, setDocsMsg] = useState('');
  const [docsUploading, setDocsUploading] = useState(false);
  const docsFileRef = useRef<HTMLInputElement>(null);

  // ── Fotos e Vídeos ────────────────────────────────────────────────────────
  const [fotosMedia, setFotosMedia] = useState<{ name: string; url: string; type: 'foto' | 'video'; size: number; created_at: string }[]>([]);
  const [fotosLoading, setFotosLoading] = useState(false);
  const [fotosUploading, setFotosUploading] = useState(false);
  const [fotosMsg, setFotosMsg] = useState('');
  const fotosFileRef = useRef<HTMLInputElement>(null);

  // ── Playlist ───────────────────────────────────────────────────────────────
  const [playlistItems, setPlaylistItems] = useState<{ id: string; title: string; url: string; platform: string; created_at: string }[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistAddUrl, setPlaylistAddUrl] = useState('');
  const [playlistAddTitle, setPlaylistAddTitle] = useState('');
  const [playlistAdding, setPlaylistAdding] = useState(false);
  const [playlistMsg, setPlaylistMsg] = useState('');
  const [playlistMsgType, setPlaylistMsgType] = useState<'success' | 'error'>('success');
  const [playlistEditId, setPlaylistEditId] = useState<string | null>(null);
  const [playlistEditTitle, setPlaylistEditTitle] = useState('');
  const [playlistEditUrl, setPlaylistEditUrl] = useState('');

  // ── Evolução / Dashboard Pessoal ───────────────────────────────────────────
  const [evolucaoDates, setEvolucaoDates] = useState<string[]>([]);
  const [evolucaoEntries, setEvolucaoEntries] = useState<{ date: string; nucleo: string | null; local_nome: string | null; hora: string | null }[]>([]);
  const [evolucaoLoading, setEvolucaoLoading] = useState(false);

  // ── Conta / Perfil ─────────────────────────────────────────────────────────
  const [contaSection, setContaSection] = useState<'main' | 'edit-profile' | 'change-password' | 'delete-account'>('main');
  const [contaForm, setContaForm] = useState({ new_username: '', new_email: '', current_password: '', new_password: '', confirm_password: '' });
  const [contaMsg, setContaMsg] = useState('');
  const [contaMsgType, setContaMsgType] = useState<'success' | 'error'>('success');
  const [contaLoading, setContaLoading] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // ── Meus Dados ────────────────────────────────────────────────────────────
  const [fotoUploading, setFotoUploading] = useState(false);
  const [fotoEditando, setFotoEditando] = useState<File | null>(null);
  const [fotoMsg, setFotoMsg] = useState('');
  const fotoInputRef = useRef<HTMLInputElement>(null);

  const [dadosForm, setDadosForm] = useState({
    nucleo: '', graduacao: '', tipo_graduacao: '',
    cpf: '', identidade: '', numeracao_unica: '', data_nascimento: '',
    telefone: '', email: '',
    cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
    nome_pai: '', nome_mae: '',
    nome_responsavel: '', cpf_responsavel: '',
    apelido: '', nome_social: '', sexo: '',
    autoriza_imagem: false as boolean,
    desenvolvimento_atipico: [] as string[],
  });
  const [dadosLoading, setDadosLoading] = useState(false);
  const [dadosMsg, setDadosMsg] = useState('');
  const [dadosMsgType, setDadosMsgType] = useState<'success' | 'error'>('success');
  const [dadosInitialized, setDadosInitialized] = useState(false);

  // ── Termo de Responsabilidade ─────────────────────────────────────────────
  const [termoForm, setTermoForm] = useState({ nome_responsavel: '', cpf_responsavel: '' });
  const [termoSaving, setTermoSaving] = useState(false);
  const [termoSaved, setTermoSaved] = useState(false);
  const [termoMsg, setTermoMsg] = useState('');
  const [termoAssinatura, setTermoAssinatura] = useState('');
  const [termoAssinaturaPng, setTermoAssinaturaPng] = useState<string | null>(null);

  // ── Ficha Financeira (inline view) ────────────────────────────────────────
  const [fichaFin, setFichaFin] = useState<Record<string, unknown> | null>(null);
  const [fichaFinLoading, setFichaFinLoading] = useState(false);

  // ── Solicitações financeiras ────────────────────────────────────────────────
  const [showSolBatizado, setShowSolBatizado] = useState(false);
  const [solBatizadoModalidade, setSolBatizadoModalidade] = useState<'integral'|'parcelado'>('integral');
  const [solBatizadoParcelas, setSolBatizadoParcelas] = useState(2);
  const [solBatizadoSaving, setSolBatizadoSaving] = useState(false);
  const [solBatizadoMsg, setSolBatizadoMsg] = useState('');

  const [showSolUniforme, setShowSolUniforme] = useState(false);
  const [solUnifItem, setSolUnifItem] = useState('');
  const [solUnifTam, setSolUnifTam] = useState('M');
  const [solUnifQtd, setSolUnifQtd] = useState(1);
  // Medidas colhidas junto da solicitação de uniforme — gravadas no cadastro (uniforme_*)
  const [solUnifMedidas, setSolUnifMedidas] = useState({ camisaTamanho: '', altura: '', cintura: '', gaviao: '', camisaGrupo: '', camisaProjeto: '' });
  const [solUnifSaving, setSolUnifSaving] = useState(false);
  const [solUnifMsg, setSolUnifMsg] = useState('');

  // ── Admin preview mode flag ────────────────────────────────────────────────
  const [isAdminPreview, setIsAdminPreview] = useState(false);

  // ── Conformidade cadastral (aviso ao tentar ação bloqueada) ────────────────
  const [conformidadeAviso, setConformidadeAviso] = useState('');

  // ── Load nucleos dinamicos ──────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/admin/nucleos')
      .then(r => r.json())
      .then(d => { if (d.nucleos) setDynamicNucleos(d.nucleos.filter((n: any) => n.ativo)); })
      .catch(() => {});
  }, []);

  // ── Load session ──────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      // Check for admin preview mode via URL param + localStorage token
      const params = new URLSearchParams(window.location.search);
      if (params.get('admin_preview') === '1') {
        const tokenRaw = localStorage.getItem('pa_admin_preview');
        if (tokenRaw) {
          const token = JSON.parse(tokenRaw);
          if (token?.student_id && token.expires > Date.now()) {
            setIsAdminPreview(true);
            setSession({ student_id: token.student_id, username: '__admin_preview__' });
            loadStudentData(token.student_id, true);
            return;
          }
        }
        // Token invalid/expired — show error
        setLoading(false);
        return;
      }

      // Deep link de notificação: /?aba=justificativas abre a aba correspondente
      // (clique na notificação push navega para o conteúdo).
      try {
        const abaUrl = new URLSearchParams(window.location.search).get('aba');
        if (abaUrl) setActiveTab(abaUrl as Tab);
      } catch { /* ignore */ }

      // Sessão persistente: cookie HttpOnly assinado (server valida, renova e
      // devolve o perfil ativo — o app abre direto no último usado)
      fetch('/api/aluno/auth', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          if (d.authenticated && d.session?.student_id) {
            setSession({ student_id: d.session.student_id, username: d.session.username });
            if (d.student) setStudent(d.student);
            const alvo = d.perfil_ativo || d.session.student_id;
            loadStudentData(alvo, true);
          } else {
            setLoading(false);
          }
        })
        .catch(() => setLoading(false));

    } catch { setLoading(false); }
  }, []);

  // Painel "Meus dependentes" da conta só-responsável (dashboard)
  useEffect(() => {
    if (!session || isAdminPreview) return;
    fetch('/api/aluno/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'account-status' }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && Array.isArray(d.tutelados)) setDependentes(d.tutelados); })
      .catch(() => {});
  }, [session, isAdminPreview, activeTab]);

  // Perfis acessíveis (o próprio + tutelados) e contexto ativo — "Quem está usando?"
  const carregarPerfis = useCallback(async () => {
    try {
      const res = await fetch('/api/aluno/contas?sessao=1', { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      if (d.authenticated) {
        setPerfis(d.perfis || []);
        setPerfilAtivo(d.perfil_ativo || d.conta?.student_id || '');
      }
    } catch {}
  }, []);

  const trocarPerfil = useCallback(async (studentId: string) => {
    setPerfilLoading(true);
    try {
      const res = await fetch('/api/aluno/contas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch-profile', student_id: studentId }),
      });
      if (res.ok) {
        setPerfilAtivo(studentId);
        // Recarrega os dados do perfil aberto (sessionEffect já carregou o próprio)
        const r2 = await fetch(`/api/aluno/dados?student_id=${studentId}`);
        if (r2.ok) {
          const d2 = await r2.json();
          if (d2.student) setStudent(d2.student);
        }
      }
    } finally {
      setPerfilLoading(false);
    }
  }, []);

  // Carrega perfis acessíveis quando a sessão existe
  useEffect(() => {
    if (session && !isAdminPreview) carregarPerfis();
  }, [session, isAdminPreview, carregarPerfis]);

  const loadStudentData = useCallback(async (student_id: string, showGlobalLoader = false) => {
    if (showGlobalLoader) setLoading(true);
    try {
      const res = await fetch(`/api/aluno/dados?student_id=${student_id}`);
      if (res.ok) {
        const { student } = await res.json();
        if (student) {
          setStudent(student);
          setStudentLoaded(true);
          // conta_tipo: 'responsavel' (só gestão) | 'responsavel_aluno' (dois perfis) | aluno normal
          const ct = (student as Record<string, unknown>).conta_tipo;
          setContaTipo(ct === 'responsavel' || ct === 'responsavel_aluno' ? 'responsavel' : 'aluno');
          setRespTambemAluno(ct === 'responsavel_aluno' ? true : ct === 'responsavel' ? false : null);
          // Fetch display ID for carteirinha (gerar-id is the authoritative source)
          const ordNum = (student as Record<string, unknown>).ordem_inscricao as number | null ?? null;
          if (ordNum) {
            setAlunoInscricaoNum(ordNum);
          } else {
            fetch(`/api/aluno/gerar-id?student_id=${encodeURIComponent(student_id)}`)
              .then(r => r.json())
              .then(d => {
                if (d.display_id) {
                  const match = (d.display_id as string).match(/(\d+)$/);
                  if (match) setAlunoInscricaoNum(parseInt(match[1], 10));
                }
              })
              .catch(() => {});
          }
        }
      } else if (res.status === 401 || res.status === 403) {
        // O perfil aberto ("Quem está usando?") pode não pertencer mais a esta
        // conta (ex.: perfil ativo deixado pela conta anterior no dispositivo).
        // Cai para a PRÓPRIA conta autenticada — a tela nunca fica no vazio.
        try {
          const chk = await fetch('/api/aluno/auth', { cache: 'no-store' });
          const d = await chk.json();
          if (d.authenticated && d.session?.student_id) {
            if (d.student) setStudent(d.student);
            await loadStudentData(d.session.student_id, false);
          } else {
            setSession(null);
            setStudent(null);
          }
        } catch { setSession(null); setStudent(null); }
      }
    } catch {}
    if (showGlobalLoader) setLoading(false);
  }, []);

  const loadJustificativas = useCallback(async (student_id: string) => {
    const res = await fetch(`/api/aluno/justificativas?student_id=${student_id}`);
    if (res.ok) setJustificativas(await res.json());
  }, []);

  const loadHistorico = useCallback(async (student_id: string) => {
    setLoadingHistorico(true);
    try {
      const res = await fetch(`/api/historico-graduacoes?student_id=${student_id}`);
      if (res.ok) {
        const { records } = await res.json();
        setHistorico(records || []);
      }
    } catch {}
    setLoadingHistorico(false);
  }, []);

  const loadFotos = useCallback(async (student_id: string) => {
    setFotosLoading(true);
    try {
      const res = await fetch(`/api/aluno/media?student_id=${student_id}`);
      if (res.ok) {
        const { files } = await res.json();
        setFotosMedia(files || []);
      }
    } catch {}
    setFotosLoading(false);
  }, []);

  const loadDocs = useCallback(async (student_id: string) => {
    setDocsLoading(true);
    try {
      const res = await fetch(`/api/aluno/docs?student_id=${student_id}`);
      if (res.ok) {
        const { docs } = await res.json();
        setDocsItems(docs || []);
      }
    } catch {}
    setDocsLoading(false);
  }, []);

  useEffect(() => {
    if (session) {
      if (activeTab === 'justificativas') loadJustificativas(alvoPerfil);
      if (activeTab === 'graduacao') {
        loadHistorico(alvoPerfil);
        setEventosLoading(true);
        fetch('/api/eventos', { cache: 'no-store' })
          .then(r => r.json())
          .then(d => { setEventos(Array.isArray(d) ? d.filter((e: any) => !e.finalizado) : []); setEventosLoading(false); })
          .catch(() => setEventosLoading(false));
      }
      if (activeTab === 'dashboard' && eventos.length === 0) {
        fetch('/api/eventos', { cache: 'no-store' })
          .then(r => r.json())
          .then(d => { setEventos(Array.isArray(d) ? d.filter((e: any) => !e.finalizado) : []); })
          .catch(() => {});
      }
      if (activeTab === 'dashboard' && !muralLoadedRef.current) {
        muralLoadedRef.current = true;
        setMuralLoading(true);
        // Mural filtrado: avisos gerais (owner/admin geral) + avisos do núcleo do aluno
        const nucleoParam = student?.nucleo ? `&nucleo=${encodeURIComponent(student.nucleo)}` : '';
        fetch(`/api/mural?scope=aluno${nucleoParam}`, { cache: 'no-store' })
          .then(r => r.json())
          .then(d => {
            const itens: MuralItem[] = Array.isArray(d.items) ? d.items : [];
            setMuralItems(itens);
            setMuralLoading(false);
            itens.filter(i => i.imagem_path).forEach(i => {
              fetch(`/api/mural/imagem?path=${encodeURIComponent(i.imagem_path!)}`)
                .then(r => r.json())
                .then(u => { if (u.url) setMuralUrls(prev => ({ ...prev, [i.imagem_path!]: u.url })); })
                .catch(() => {});
            });
          })
          .catch(() => setMuralLoading(false));
      }
      if (activeTab === 'fotos') loadFotos(alvoPerfil);
      if (activeTab === 'docs') loadDocs(alvoPerfil);
      if (activeTab === 'financeiro') {
        setFichaFinLoading(true);
        fetch(`/api/financeiro?student_id=${alvoPerfil}`)
          .then(r => r.json())
          .then(d => { setFichaFin(d); setFichaFinLoading(false); })
          .catch(() => setFichaFinLoading(false));
      }
      if (activeTab === 'playlist') {
        setPlaylistLoading(true);
        fetch(`/api/aluno/playlist?student_id=${alvoPerfil}`).then(r => r.json()).then(d => { setPlaylistItems(Array.isArray(d) ? d : []); setPlaylistLoading(false); }).catch(() => setPlaylistLoading(false));
      }
      if (activeTab === 'evolucao') {
        setEvolucaoLoading(true);
        fetch(`/api/aluno/evolucao?student_id=${alvoPerfil}`).then(r => r.json()).then(d => { setEvolucaoDates(Array.isArray(d.dates) ? d.dates : []); setEvolucaoEntries(Array.isArray(d.entries) ? d.entries : []); setEvolucaoLoading(false); }).catch(() => setEvolucaoLoading(false));
      }
    }
  }, [session, activeTab, student, loadJustificativas, loadHistorico, loadFotos, loadDocs]);

  // ── Login handler ─────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Date.now() < lockedUntil) {
      setLoginError(`Muitas tentativas. Aguarde ${Math.ceil((lockedUntil - Date.now()) / 60000)} minuto(s).`);
      return;
    }
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/aluno/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', ...loginForm }),
      });
      const data = await res.json();
      if (!res.ok) {
        const newAttempts = loginAttempts + 1;
        setLoginAttempts(newAttempts);
        if (newAttempts >= 5) {
          setLockedUntil(Date.now() + 5 * 60 * 1000);
          setLoginError('Muitas tentativas. Aguarde 5 minutos.');
        } else {
          setLoginError(data.error || 'Usuário ou senha incorretos.');
        }
        return;
      }
      setLoginAttempts(0);
      const sess = { student_id: data.student_id, username: data.username };
      // O cookie de sessão foi gravado pelo servidor; guarda espelho leve para render imediato
      try { sessionStorage.setItem('aluno_session', JSON.stringify(sess)); } catch {}
      // Pre-populate with login response so dashboard renders immediately
      if (data.student) setStudent(data.student);
      setSession(sess);
      setActiveTab('dashboard');
      // Recarga completa sempre — dados enxutos do login não bastam para o
      // formulário de dados (data de nascimento → termo) nem para o ID.
      setDadosInitialized(false);
      loadStudentData(data.student_id);
    } catch { setLoginError('Erro de conexão. Tente novamente.'); }
    finally { setLoginLoading(false); }
  };

  const handleLogout = async () => {
    try { await fetch('/api/aluno/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'logout' }) }); } catch {}
    try { sessionStorage.removeItem('aluno_session'); } catch {}
    setSession(null);
    setStudent(null);
    setActiveTab('dashboard');
  };

  const handleRegisterResponsavel = async (e: React.FormEvent) => {
    e.preventDefault();
    setRespError(''); setRespSuccess('');
    const soDigitos = (v: string) => v.replace(/\D/g, '');
    const cpfOk = (() => {
      const d = soDigitos(respForm.cpf);
      if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
      let soma = 0;
      for (let i = 0; i < 9; i++) soma += parseInt(d[i]) * (10 - i);
      let r = (soma * 10) % 11; if (r === 10 || r === 11) r = 0;
      if (r !== parseInt(d[9])) return false;
      soma = 0;
      for (let i = 0; i < 10; i++) soma += parseInt(d[i]) * (11 - i);
      r = (soma * 10) % 11; if (r === 10 || r === 11) r = 0;
      return r === parseInt(d[10]);
    })();
    if (respForm.nome_completo.trim().split(/\s+/).filter(Boolean).length < 2) { setRespError('Informe seu nome completo.'); return; }
    if (!cpfOk) { setRespError('Informe um CPF válido — ele é obrigatório na conta de responsável.'); return; }
    if (!respForm.data_nascimento) { setRespError('Informe sua data de nascimento.'); return; }
    const idadeResp = (() => {
      const n = new Date(`${respForm.data_nascimento}T12:00:00`);
      if (isNaN(n.getTime())) return -1;
      const hj = new Date(); let a = hj.getFullYear() - n.getFullYear();
      const m = hj.getMonth() - n.getMonth();
      if (m < 0 || (m === 0 && hj.getDate() < n.getDate())) a--;
      return a;
    })();
    if (idadeResp >= 0 && idadeResp < 18) { setRespError('Função de responsável indisponível: é necessário ter 18 anos ou mais.'); return; }
    if (!respForm.email.trim()) { setRespError('Informe um e-mail válido.'); return; }
    if (respForm.password.length < 6) { setRespError('Senha deve ter pelo menos 6 caracteres.'); return; }
    if (respForm.password !== respForm.confirmPassword) { setRespError('As senhas não coincidem.'); return; }

    setRespLoading(true);
    try {
      const res = await fetch('/api/aluno/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register-responsavel',
          nome_completo: respForm.nome_completo.trim(),
          cpf: respForm.cpf,
          data_nascimento: respForm.data_nascimento,
          email: respForm.email.trim().toLowerCase(),
          phone: respForm.phone.trim(),
          password: respForm.password,
          tambem_aluno: respTambemAluno === true,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setRespError(data.error || 'Erro ao criar a conta.'); return; }
      // Conta criada e logada — responsável já entra no app com o próprio perfil
      setRespSuccess('Conta criada! Entrando no portal...');
      try { sessionStorage.setItem('aluno_session', JSON.stringify({ student_id: data.student_id, username: data.username || respForm.email.trim().toLowerCase() })); } catch {}
      setTimeout(() => {
        setSession({ student_id: data.student_id, username: data.username || respForm.email.trim().toLowerCase() });
        setStudent(null);
        setShowRegister(false);
        setRegisterTipo(null); setRespTambemAluno(null);
        setRespForm({ nome_completo: '', cpf: '', data_nascimento: '', email: '', phone: '', password: '', confirmPassword: '' });
        if (data.student_id) {
          // Recarga completa — perfil de responsável também precisa da linha inteira
          setDadosInitialized(false);
          loadStudentData(data.student_id, true);
        }
        // O seletor "Quem está usando?" deve exibir já o perfil de responsável
        carregarPerfis();
      }, 900);
    } catch { setRespError('Erro de conexão. Tente novamente.'); }
    finally { setRespLoading(false); }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError(''); setRegisterSuccess('');

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!registerForm.email.trim()) { setRegisterError('E-mail é obrigatório.'); return; }
    if (!emailRegex.test(registerForm.email.trim())) { setRegisterError('Informe um e-mail válido.'); return; }
    if (registerForm.password.length < 6) { setRegisterError('Senha deve ter pelo menos 6 caracteres.'); return; }
    if (registerForm.password !== registerForm.confirmPassword) { setRegisterError('As senhas não coincidem.'); return; }
    if (!registerForm.data_nascimento.trim()) { setRegisterError('Informe sua data de nascimento.'); return; }

    setRegisterLoading(true);
    try {
      // Step 1: try by CPF/doc if provided
      if (registerForm.cpf_or_doc.trim()) {
        const res = await fetch('/api/aluno/auth', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'register',
            cpf_or_doc: registerForm.cpf_or_doc.trim(),
            username: registerForm.email.trim().toLowerCase(),
            email: registerForm.email.trim().toLowerCase(),
            password: registerForm.password,
            phone: registerForm.phone.trim(),
            nome_completo: registerForm.username.trim(),
            data_nascimento: registerForm.data_nascimento.trim(),
          }),
        });
        const data = await res.json();
        if (res.ok) {
          // Conta criada e já logada (cookie gravado pelo servidor)
          setRegisterSuccess('Conta criada! Entrando no portal...');
          if (data.student_id) {
            try { sessionStorage.setItem('aluno_session', JSON.stringify({ student_id: data.student_id, username: data.username || registerForm.email.trim().toLowerCase() })); } catch {}
            setTimeout(() => {
              setSession({ student_id: data.student_id, username: data.username || registerForm.email.trim().toLowerCase() });
              if (data.student) setStudent(data.student);
              setShowRegister(false);
              setRegisterTipo(null);
              // Recarga completa SEMPRE — a resposta de cadastro vem enxuta e o
              // formulário/dados (termo, ID) precisam da linha inteira do banco.
              setDadosInitialized(false);
              loadStudentData(data.student_id, true);
            }, 900);
          } else {
            setTimeout(() => { setShowRegister(false); setRegisterTipo(null); }, 2000);
          }
          return;
        }
        // If CPF not found, fall through to name-based
        if (!data.hint || data.hint !== 'nome') {
          setRegisterError(data.error || 'Erro ao criar conta.'); return;
        }
      }

      // Step 2: name-based registration (when no CPF or CPF not found)
      if (!registerForm.username.trim()) { setRegisterError('Informe seu nome completo exatamente como está cadastrado.'); return; }
      const res2 = await fetch('/api/aluno/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register-by-name',
          nome_completo: registerForm.username.trim(),
          email: registerForm.email.trim().toLowerCase(),
          password: registerForm.password,
          data_nascimento: registerForm.data_nascimento.trim(),
        }),
      });
      const data2 = await res2.json();
      if (!res2.ok) {
        let msg = data2.error || 'Erro ao criar conta.';
        if (data2.candidates?.length) msg += `\n\nNomes similares encontrados:\n• ${data2.candidates.join('\n• ')}`;
        setRegisterError(msg); return;
      }
      // Conta criada e já logada (cookie gravado pelo servidor)
      setRegisterSuccess('Conta criada! Entrando no portal...');
      try { sessionStorage.setItem('aluno_session', JSON.stringify({ student_id: data2.student_id, username: data2.username || registerForm.email.trim().toLowerCase() })); } catch {}
      setTimeout(() => {
        setSession({ student_id: data2.student_id, username: data2.username || registerForm.email.trim().toLowerCase() });
        if (data2.student) setStudent(data2.student);
        setShowRegister(false);
        setRegisterTipo(null);
        // Recarga completa SEMPRE — termo e ID dependem da linha inteira.
        setDadosInitialized(false);
        loadStudentData(data2.student_id, true);
      }, 900);
    } catch { setRegisterError('Erro de conexão. Tente novamente.'); }
    finally { setRegisterLoading(false); }
  };

  const handlePresenca = async () => {
    if (!exigirConformidade(pendencias.some(p => p.campo === 'termo') ? 'termo' : 'dados')) return;
    if (!navigator.geolocation) { setPresencaMsg('Geolocalização não disponível neste dispositivo.'); setPresencaStatus('error'); return; }
    if (!student?.nucleo) {
      setPresencaMsg('Você precisa estar vinculado a um núcleo para registrar presença. Escolha seu núcleo na aba Meus Dados.');
      setPresencaStatus('error');
      return;
    }
    setPresencaLoading(true); setPresencaMsg(''); setPresencaStatus('idle');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const res = await fetch('/api/checkins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student: {
              id: alvoPerfil, // perfil aberto (tutelado) — nunca a conta por baixo
              nome_completo: student?.nome_completo || '',
              graduacao: student?.graduacao || '',
              nucleo: student.nucleo,
              local_treino: student.nucleo,
              foto_url: student?.foto_url || null,
              telefone: student?.telefone || '',
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) { setPresencaMsg(data.error || 'Não foi possível registrar presença.'); setPresencaStatus('error'); }
        else if (data.alreadyRegistered) { setPresencaMsg('Presença já registrada hoje!'); setPresencaStatus('success'); }
        else { setPresencaMsg('Presença registrada com sucesso!'); setPresencaStatus('success'); }
      } catch { setPresencaMsg('Erro ao registrar presença.'); setPresencaStatus('error'); }
      finally { setPresencaLoading(false); }
    }, () => { setPresencaMsg('Permissão de localização negada. Por favor, permita o acesso à localização.'); setPresencaStatus('error'); setPresencaLoading(false); });
  };

  const handleSubmitJustificativa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exigirConformidade(pendencias.some(p => p.campo === 'termo') ? 'termo' : 'dados')) return;
    setJustLoading(true); setJustMsg('');
    try {
      const res = await fetch('/api/aluno/justificativas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', student_id: alvoPerfil, ...justForm }) });
      const data = await res.json();
      if (!res.ok) { setJustMsg(data.error || 'Erro.'); setJustMsgType('error'); return; }
      setJustMsg('Justificativa enviada com sucesso!');
      setJustMsgType('success');
      setJustForm({ data_falta: '', motivo: '' });
      loadJustificativas(alvoPerfil);
    } catch { setJustMsg('Erro de conexão.'); setJustMsgType('error'); }
    finally { setJustLoading(false); }
  };

  // Populate termo form when student data is loaded — sempre REINICIA o estado
  // ao trocar de aluno/perfil (sem isso, "termo assinado" e a assinatura
  // desenhada do perfil anterior vazavam para o aluno seguinte)
  useEffect(() => {
    if (!student) return;
    const assinado = !!student.assinatura_responsavel;
    setTermoForm({
      nome_responsavel: student.nome_responsavel as string || '',
      cpf_responsavel: student.cpf_responsavel as string || '',
    });
    setTermoSaved(assinado);
    setTermoAssinatura('');
    setTermoAssinaturaPng(null);
    setTermoMsg('');
    if (assinado) {
      // Assinatura registrada volta como imagem (para o documento impresso)
      fetch(`/api/termo?id=${student.id}`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d?.assinatura_png) setTermoAssinaturaPng(d.assinatura_png); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, student?.assinatura_responsavel]);

  // ── Conformidade cadastral (documentos + termo de menor) ───────────────────
  const docsAluno: StudentDocsLike | null = student ? {
    cpf: (student.cpf as string) || null,
    identidade: (student.identidade as string) || null,
    data_nascimento: (student.data_nascimento as string) || null,
    menor_de_idade: typeof student.menor_de_idade === 'boolean' ? student.menor_de_idade : null,
    assinatura_responsavel: (student.assinatura_responsavel as boolean) || false,
    nome_responsavel: (student.nome_responsavel as string) || null,
    cpf_responsavel: (student.cpf_responsavel as string) || null,
  } : null;
  const pendencias = docsAluno ? pendenciasAluno(docsAluno) : [];
  const emConformidade = isAdminPreview || pendencias.length === 0;
  const pendenciasResumo = docsAluno ? resumoPendencias(docsAluno) : '';

  /** Bloqueia a ação do aluno irregular e aponta para a aba que resolve. */
  const exigirConformidade = (destino: Tab = 'dados'): boolean => {
    if (!docsAluno || pendencias.length === 0) return true;
    setConformidadeAviso(`Cadastro incompleto — pendência(s): ${pendenciasResumo}. Complete para usar esta função.`);
    setActiveTab(destino);
    return false;
  };

  // Populate dados form when student data is loaded or tab activated
  useEffect(() => {
    if (student && (activeTab === 'dados' || !dadosInitialized)) {
      setDadosForm({
        nucleo:           student.nucleo           as string || '',
        graduacao:        student.graduacao         as string || '',
        tipo_graduacao:   (() => { const t = (student.tipo_graduacao as string || '').toLowerCase(); return t === 'infantil' ? 'Infantil' : t === 'adulta' || t === 'adulto' ? 'Adulto' : (student.tipo_graduacao as string || ''); })(),

        cpf:              student.cpf               as string || '',
        identidade:       student.identidade        as string || '',
        numeracao_unica:  (student.numeracao_unica  as string) || '',
        // slice(0,10): o banco pode guardar timestamp (…T00:00:00.000Z) e o
        // <input type="date"> só aceita AAAA-MM-DD — sem isso o campo aparece vazio
        data_nascimento:  (student.data_nascimento  as string || '').slice(0, 10),
        telefone:         student.telefone          as string || '',
        email:            student.email             as string || '',
        cep:              (student.cep              as string) || '',
        endereco:         (student.endereco         as string) || '',
        numero:           (student.numero           as string) || '',
        complemento:      (student.complemento      as string) || '',
        bairro:           (student.bairro           as string) || '',
        cidade:           (student.cidade           as string) || '',
        estado:           (student.estado           as string) || '',
        nome_pai:         student.nome_pai          as string || '',
        nome_mae:         student.nome_mae          as string || '',
        nome_responsavel: student.nome_responsavel  as string || '',
        cpf_responsavel:  student.cpf_responsavel   as string || '',
        apelido:          student.apelido           as string || '',
        nome_social:      student.nome_social       as string || '',
        sexo:             student.sexo              as string || '',
        autoriza_imagem:  !!(student.autoriza_imagem),
        desenvolvimento_atipico: Array.isArray(student.desenvolvimento_atipico) ? student.desenvolvimento_atipico as string[] : [],
      });
      setDadosInitialized(true);
    }
  }, [student, activeTab, dadosInitialized]);

  // Gender-based theme: M=green, F=red, otherwise nucleo color
  // M = blue (#1d4ed8), F = red (#dc2626), others fallback to nucleo color
  const nucleoColor = '#FF9200';
  const cordaColors = getCordaColors(student?.graduacao || '');

  // Cadastro incompleto — só avalia depois que student foi carregado do servidor (studentLoaded é one-way: false→true, nunca volta)
  // Responsável puro não tem "cadastro de aluno" para completar.
  const cadastroIncompleto = studentLoaded && student !== null && contaTipo !== 'responsavel' && (
    !student.nucleo ||
    !student.graduacao ||
    !student.telefone ||
    !student.data_nascimento ||
    !student.email ||
    !(student as any).sexo ||
    ((student as any).autoriza_imagem === null || (student as any).autoriza_imagem === undefined)
  );

  const cartData = student ? {
    nome: student.nome_completo,
    cpf: student.cpf || '',
    identidade: student.identidade || '',
    nucleo: student.nucleo || '',
    graduacao: student.graduacao || '',
    tipo_graduacao: student.tipo_graduacao || '',
    foto_url: student.foto_url || null,
    menor_de_idade: !!student.menor_de_idade,
    nome_pai: student.nome_pai as string || '',
    nome_mae: student.nome_mae as string || '',
    nome_responsavel: student.nome_responsavel as string || '',
    cpf_responsavel: student.cpf_responsavel as string || '',
    inscricao_numero: alunoInscricaoNum ?? (student.inscricao_numero as number | null) ?? null,
    telefone: student.telefone || '',
    student_id: student.id,
    data_nascimento: student.data_nascimento || '',
  } : null;

  // ── LOGIN (só aparece depois de verificar a sessão salva no cookie) ───────
  if (!session && !loading && !showRegister && !showForgot) {
    return (
      <div className="pa-auth">
        <div className="pa-auth-inner">
          {/* Logo */}
          <div className="pa-auth-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-portal-aluno.png" alt="Portal Aluno" />
            <h1>Portal <span>Aluno</span></h1>
            <p>Sua vida na capoeira em um só lugar</p>
          </div>

          <div className="pa-card">
            <h2>Entrar na minha conta</h2>
            <p className="pa-sub">Acesse sua carteirinha, presenças e histórico de graduação.</p>

            {loginError && (
              <div className="pa-alert pa-alert-error">{loginError}</div>
            )}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="pa-field" style={{ marginBottom: 0 }}>
                <label htmlFor="login-user">Usuário ou E-mail</label>
                <input id="login-user" type="text" value={loginForm.username} onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))}
                  placeholder="Seu usuário ou e-mail" required autoComplete="username" />
              </div>
              <div className="pa-field" style={{ marginBottom: 0 }}>
                <label htmlFor="login-pass">Senha</label>
                <input id="login-pass" type="password" value={loginForm.password} onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Sua senha" required autoComplete="current-password" />
              </div>
              <button type="submit" className="pa-btn" disabled={loginLoading || Date.now() < lockedUntil}>
                {loginLoading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>

            <div className="pa-row">
              <button onClick={() => setShowForgot(true)} className="pa-btn-ghost">Esqueci minha senha</button>
              <button onClick={() => { setRegisterTipo(null); setRespTambemAluno(null); setRespForm({ nome_completo: '', cpf: '', data_nascimento: '', email: '', phone: '', password: '', confirmPassword: '' }); setShowRegister(true); }} className="pa-btn-ghost">Criar conta →</button>
            </div>

            <div className="pa-divider" />
            <a href="/" className="pa-btn-ghost" style={{ display: 'block', textAlign: 'center', fontSize: '0.8rem' }}>← Voltar à página inicial</a>
          </div>

          <AppFooter variante="capa" />
        </div>
      </div>
    );
  }

  // ── REGISTER ──────────────────────────────────────────────────────────────
  if (showRegister) {
    // PASSO 1: escolha do tipo de conta (responsável ou aluno)
    if (registerTipo === null) {
      return (
        <div className="pa-auth" style={{ alignItems: 'flex-start', overflowY: 'auto' }}>
          <div className="pa-auth-inner" style={{ padding: '32px 0' }}>
            <div className="pa-auth-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-portal-aluno.png" alt="Portal Aluno" />
              <h1>Criar <span>Conta</span></h1>
              <p>Escolha o tipo de conta para começar</p>
            </div>

            <div className="pa-card">
              <div className="pa-steps" aria-hidden="true"><i className="on" /><i /><i /></div>
              <div className="pa-steps-label">Passo 1 de 3 — tipo de conta</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" onClick={() => { setRegisterTipo('responsavel'); setRespTambemAluno(null); }} className="press"
                  style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '14px 15px', cursor: 'pointer' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.3), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.35)', color: '#FF9200', flexShrink: 0 }}>
                      <IconUsers size={17} />
                    </span>
                    <strong style={{ fontSize: '0.95rem', color: '#f5f5f4' }}>Sou responsável</strong>
                  </span>
                  <span style={{ display: 'block', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                    Para pais, mães e responsáveis legais acompanharem alunos menores: presença, graduação, avisos e justificativas.
                    Você escolhe se <strong style={{ color: '#d4d4d4' }}>também treina</strong> (vira aluno) ou se é <strong style={{ color: '#d4d4d4' }}>só responsável</strong>.
                    Depois de criar, você cadastra os dependentes.
                  </span>
                </button>

                <button type="button" onClick={() => setRegisterTipo('aluno')} className="press"
                  style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '14px 15px', cursor: 'pointer' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 5 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.3), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.35)', color: '#FF9200', flexShrink: 0 }}>
                      <IconUser size={17} />
                    </span>
                    <strong style={{ fontSize: '0.95rem', color: '#f5f5f4' }}>Sou aluno</strong>
                  </span>
                  <span style={{ display: 'block', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                    Para quem treina: carteirinha, presença, graduação, eventos e financeiro no app.
                    A conta se conecta ao seu cadastro na associação — menores de 15 anos devem ser cadastrados pelo responsável.
                  </span>
                </button>
              </div>

              <div className="pa-divider" />
              <button onClick={() => setRegisterTipo(null)} className="pa-btn-ghost" style={{ display: 'block', width: '100%', fontSize: '0.85rem' }}>
                ← Voltar
              </button>
            </div>
          </div>
        </div>
      );
    }

    // PASSO 2 (responsável): também é aluno? + dados da conta
    if (registerTipo === 'responsavel') {
      const cpfDigitos = respForm.cpf.replace(/\D/g, '');
      const senhasIguais = !!respForm.confirmPassword && respForm.confirmPassword === respForm.password;
      return (
        <div className="pa-auth" style={{ alignItems: 'flex-start', overflowY: 'auto' }}>
          <div className="pa-auth-inner" style={{ padding: '32px 0' }}>
            <div className="pa-auth-logo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-portal-aluno.png" alt="Portal Aluno" />
              <h1>Conta de <span>Responsável</span></h1>
              <p>{respTambemAluno === null ? 'Você também treina?' : 'Seus dados de acesso'}</p>
            </div>

            <div className="pa-card">
              <div className="pa-steps" aria-hidden="true"><i className="on" /><i className="on" /><i /></div>
              <div className="pa-steps-label">{respTambemAluno === null ? 'Passo 2 de 3 — seu perfil' : 'Passo 3 de 3 — seus dados'}</div>

              {respError && <div className="pa-alert pa-alert-error">{respError}</div>}
              {respSuccess && <div className="pa-alert pa-alert-success">{respSuccess}</div>}

              {respTambemAluno === null ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button type="button" onClick={() => setRespTambemAluno(true)} className="press"
                      style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '13px 15px', cursor: 'pointer' }}>
                      <strong style={{ display: 'block', fontSize: '0.92rem', color: '#f5f5f4', marginBottom: 3 }}>Sim — também sou aluno</strong>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                        Uma única conta com os dois perfis: você acompanha seus dependentes <strong style={{ color: '#d4d4d4' }}>e</strong> tem carteirinha, presença e graduação próprios.
                        Depois de entrar, o cadastro de aluno se conecta ao seu vínculo na associação.
                      </span>
                    </button>
                    <button type="button" onClick={() => setRespTambemAluno(false)} className="press"
                      style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '13px 15px', cursor: 'pointer' }}>
                      <strong style={{ display: 'block', fontSize: '0.92rem', color: '#f5f5f4', marginBottom: 3 }}>Não — só responsável</strong>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                        Conta apenas para gerenciar quem você representa: adicionar dependentes e acompanhar presença, graduação e avisos deles.
                        Sem carteirinha nem treinos para você.
                      </span>
                    </button>
                  </div>
                  <div className="pa-divider" />
                  <button onClick={() => setRegisterTipo(null)} className="pa-btn-ghost" style={{ display: 'block', width: '100%', fontSize: '0.85rem' }}>
                    ← Voltar
                  </button>
                </>
              ) : (
                <form onSubmit={handleRegisterResponsavel} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div className="pa-field">
                    <label htmlFor="resp-nome">Nome completo *</label>
                    <input id="resp-nome" type="text" value={respForm.nome_completo}
                      onChange={e => setRespForm(p => ({ ...p, nome_completo: e.target.value }))}
                      placeholder="Ex: Carlos da Silva" required autoFocus />
                  </div>
                  <div className="pa-field">
                    <label htmlFor="resp-cpf">CPF *</label>
                    <input id="resp-cpf" type="text" inputMode="numeric" value={respForm.cpf}
                      onChange={e => setRespForm(p => ({ ...p, cpf: e.target.value }))}
                      placeholder="000.000.000-00" required />
                    <p className="pa-hint">Usado para confirmar sua identidade como responsável — fica protegido.</p>
                  </div>
                  <div className="pa-field">
                    <label htmlFor="resp-dob">Data de nascimento *</label>
                    <input id="resp-dob" type="date" value={respForm.data_nascimento}
                      onChange={e => setRespForm(p => ({ ...p, data_nascimento: e.target.value }))}
                      max={new Date().toISOString().slice(0, 10)} required />
                    <p className="pa-hint">A função de responsável exige 18 anos ou mais.</p>
                  </div>
                  {respTambemAluno === false && (
                    <div className="pa-alert pa-alert-info" style={{ margin: '6px 0' }}>
                      Conta só de responsável: depois de entrar, use <strong>Perfil de Guardião</strong> para cadastrar seus dependentes.
                    </div>
                  )}
                  {respTambemAluno === true && (
                    <div className="pa-alert pa-alert-info" style={{ margin: '6px 0' }}>
                      Além da gestão dos dependentes, você terá perfil de aluno. Complete seus dados de aluno (núcleo, documentos) na aba <strong>Meus Dados</strong>.
                    </div>
                  )}
                  <div className="pa-field">
                    <label htmlFor="resp-phone">Telefone/WhatsApp <span style={{ opacity: 0.6, textTransform: 'none', fontWeight: 400 }}>(opcional)</span></label>
                    <input id="resp-phone" type="tel" value={respForm.phone}
                      onChange={e => setRespForm(p => ({ ...p, phone: e.target.value }))}
                      placeholder="(21) 99999-9999" />
                  </div>
                  <div className="pa-field">
                    <label htmlFor="resp-email">E-mail *</label>
                    <input id="resp-email" type="email" value={respForm.email}
                      onChange={e => setRespForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="seu@email.com" required />
                  </div>
                  <div className="pa-field">
                    <label htmlFor="resp-pass">Senha *</label>
                    <input id="resp-pass" type="password" value={respForm.password}
                      onChange={e => setRespForm(p => ({ ...p, password: e.target.value }))}
                      placeholder="Mínimo 6 caracteres" required minLength={6} />
                  </div>
                  <div className="pa-field">
                    <label htmlFor="resp-pass2">Confirmar Senha *</label>
                    <input id="resp-pass2" type="password" value={respForm.confirmPassword}
                      onChange={e => setRespForm(p => ({ ...p, confirmPassword: e.target.value }))}
                      placeholder="Repita a senha" required minLength={6} />
                    {respForm.confirmPassword && !senhasIguais && <p className="pa-hint" style={{ color: '#f87171' }}>As senhas não coincidem</p>}
                    {senhasIguais && <p className="pa-hint" style={{ color: '#4ade80' }}>✓ Senhas coincidem</p>}
                    {cpfDigitos.length > 0 && cpfDigitos.length !== 11 && <p className="pa-hint" style={{ color: '#f87171' }}>CPF deve ter 11 dígitos</p>}
                  </div>

                  <button type="submit" className="pa-btn" disabled={respLoading || !!respSuccess} style={{ marginTop: 8 }}>
                    {respLoading ? 'Criando conta...' : respSuccess ? 'Preparando seu acesso...' : 'Criar minha conta'}
                  </button>
                </form>
              )}

              <div className="pa-divider" />
              <button onClick={() => { setRegisterTipo(null); setRespTambemAluno(null); setRespError(''); }} className="pa-btn-ghost" style={{ display: 'block', width: '100%', fontSize: '0.85rem' }}>
                ← Voltar
              </button>
            </div>
          </div>
        </div>
      );
    }

    // PASSO 2/3 (aluno): fluxo normal existente
    const emailValid = !registerForm.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerForm.email.trim());
    const passwordsMatch = !registerForm.confirmPassword || registerForm.confirmPassword === registerForm.password;

    return (
      <div className="pa-auth" style={{ alignItems: 'flex-start', overflowY: 'auto' }}>
        <div className="pa-auth-inner" style={{ padding: '32px 0' }}>
          <div className="pa-auth-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-portal-aluno.png" alt="Portal Aluno" />
            <h1>Criar <span>Conta</span></h1>
            <p>Um cadastro, acesso a tudo: carteirinha, presenças e graduações</p>
          </div>

          <div className="pa-card">
            <div className="pa-steps" aria-hidden="true"><i className="on" /><i className="on" /><i /></div>
            <div className="pa-steps-label">Passo 2 de 3 — seus dados de acesso</div>

            {registerError && (
              <div className="pa-alert pa-alert-error">
                {registerError}
                <button type="button" onClick={() => setRegisterTipo(null)} style={{ display: 'block', marginTop: 8, background: 'none', border: 'none', color: '#fca5a5', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '0.78rem', fontWeight: 700 }}>
                  ← Escolher outro tipo de conta
                </button>
              </div>
            )}
            {registerSuccess && (
              <div className="pa-alert pa-alert-success">{registerSuccess}</div>
            )}

            <div className="pa-alert pa-alert-info">
              Sua conta já cria o cadastro na associação. Depois, complete o que faltar (núcleo, endereço, documentos) na aba <strong>Meus Dados</strong>.
            </div>

            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Nome completo */}
              <div className="pa-field">
                <label htmlFor="reg-nome">Nome completo *</label>
                <input
                  id="reg-nome"
                  type="text"
                  value={registerForm.username}
                  onChange={e => setRegisterForm(p => ({ ...p, username: e.target.value }))}
                  placeholder="Ex: João da Silva Santos"
                  required autoFocus
                />
                <p className="pa-hint">Seu nome completo — ele será seu cadastro na associação</p>
              </div>

              {/* CPF (opcional) */}
              <div className="pa-field">
                <label htmlFor="reg-cpf">CPF <span style={{ opacity: 0.6, textTransform: 'none', fontWeight: 400 }}>(opcional)</span></label>
                <input
                  id="reg-cpf"
                  type="text" inputMode="numeric"
                  value={registerForm.cpf_or_doc}
                  onChange={e => setRegisterForm(p => ({ ...p, cpf_or_doc: e.target.value }))}
                  placeholder="000.000.000-00"
                />
              </div>

              {/* Data de nascimento — define as regras de idade da conta */}
              <div className="pa-field">
                <label htmlFor="reg-dob">Data de nascimento *</label>
                <input
                  id="reg-dob"
                  type="date"
                  value={registerForm.data_nascimento}
                  onChange={e => setRegisterForm(p => ({ ...p, data_nascimento: e.target.value }))}
                  max={new Date().toISOString().slice(0, 10)}
                  required
                />
                <p className="pa-hint">Menores de 15 anos devem ser cadastrados pelo responsável. De 15 a 17, a conta precisa da autorização do responsável.</p>
              </div>

              {/* Telefone (opcional) */}
              <div className="pa-field">
                <label htmlFor="reg-phone">Telefone/WhatsApp <span style={{ opacity: 0.6, textTransform: 'none', fontWeight: 400 }}>(opcional)</span></label>
                <input
                  id="reg-phone"
                  type="tel"
                  value={registerForm.phone}
                  onChange={e => setRegisterForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="(21) 99999-9999"
                />
              </div>

              {/* Email */}
              <div className="pa-field">
                <label htmlFor="reg-email">E-mail *</label>
                <input
                  id="reg-email"
                  type="email"
                  value={registerForm.email}
                  onChange={e => setRegisterForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="seu@email.com"
                  required
                />
                {registerForm.email && !emailValid && <p className="pa-hint" style={{ color: '#f87171' }}>E-mail inválido</p>}
              </div>

              {/* Password */}
              <div className="pa-field">
                <label htmlFor="reg-pass">Senha *</label>
                <input
                  id="reg-pass"
                  type="password"
                  value={registerForm.password}
                  onChange={e => setRegisterForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                  required minLength={6}
                />
                {registerForm.password && registerForm.password.length < 6 && <p className="pa-hint" style={{ color: '#f87171' }}>Mínimo 6 caracteres</p>}
              </div>

              {/* Confirm Password */}
              <div className="pa-field">
                <label htmlFor="reg-pass2">Confirmar Senha *</label>
                <input
                  id="reg-pass2"
                  type="password"
                  value={registerForm.confirmPassword}
                  onChange={e => setRegisterForm(p => ({ ...p, confirmPassword: e.target.value }))}
                  placeholder="Repita a senha"
                  required minLength={6}
                />
                {!passwordsMatch && <p className="pa-hint" style={{ color: '#f87171' }}>As senhas não coincidem</p>}
                {passwordsMatch && registerForm.confirmPassword && <p className="pa-hint" style={{ color: '#4ade80' }}>✓ Senhas coincidem</p>}
              </div>

              <button
                type="submit"
                className="pa-btn"
                disabled={registerLoading || !!registerSuccess}
                style={{ marginTop: 8 }}>
                {registerLoading ? 'Criando conta...' : registerSuccess ? 'Preparando seu acesso...' : 'Criar minha conta'}
              </button>
            </form>

            <div className="pa-divider" />
            <button onClick={() => { setRegisterTipo(null); setRegisterError(''); setRegisterSuccess(''); }} className="pa-btn-ghost" style={{ display: 'block', width: '100%', fontSize: '0.85rem' }}>
              ← Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── FORGOT PASSWORD ───────────────────────────────────────────────────────
  if (showForgot) {
    const inpStyle = { width: '100%', background: 'rgba(10,10,12,0.6)', color: '#f5f5f4', border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '11px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' as const };
    const lblStyle = { display: 'block', fontSize: '0.8rem', fontWeight: 600 as const, color: '#d4d4d4', marginBottom: 5 };

    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#0f172a,#1e293b)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 20, padding: '32px 28px', width: '100%', maxWidth: 400, boxShadow: '0 25px 60px rgba(0,0,0,0.4)' }}>

          {forgotStep === 'done' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, rgba(34,197,94,0.30), rgba(34,197,94,0.08))', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80' }}><IconCheck size={30} /></span></div>
              <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', fontWeight: 800, color: '#f5f5f4' }}>Senha redefinida!</h2>
              <p style={{ fontSize: '0.85rem', color: '#a3a3a3', marginBottom: 20 }}>Sua nova senha foi salva com sucesso. Você já pode fazer login.</p>
              <button onClick={() => { setShowForgot(false); setForgotStep('lookup'); setForgotInput(''); setForgotMsg(''); setResetMsg(''); setResetPassword(''); setResetConfirmPassword(''); setResetOtp(''); }}
                style={{ background: 'linear-gradient(135deg,#FF9200,#c86a00)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 32px', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' }}>
                Entrar agora
              </button>
            </div>
          ) : forgotStep === 'reset' ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 60, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, rgba(255,146,0,0.30), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.4)', color: '#FF9200' }}><IconBell size={28} /></span></div>
                <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 700 }}>Digite o código</h2>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#a3a3a3' }}>Enviamos um código de 6 dígitos para os canais vinculados à sua conta. Ele expira em 15 minutos.</p>
              </div>
              {resetMsg && <div style={{ background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: '0.83rem' }}>{resetMsg}</div>}
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (resetOtp.replace(/\D/g, '').length !== 6) { setResetMsg('Digite o código de 6 dígitos que você recebeu.'); return; }
                if (resetPassword.length < 6) { setResetMsg('Senha deve ter pelo menos 6 caracteres.'); return; }
                if (resetPassword !== resetConfirmPassword) { setResetMsg('As senhas não coincidem.'); return; }
                setForgotLoading(true); setResetMsg('');
                try {
                  // 1) Verifica o código; 2) só então redefine a senha
                  const vRes = await fetch('/api/aluno/auth', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'verify-otp-reset', student_id: forgotStudentId, otp: resetOtp }),
                  });
                  const vData = await vRes.json();
                  if (!vRes.ok) { setResetMsg(vData.error || 'Código inválido.'); return; }
                  const res = await fetch('/api/aluno/auth', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'reset-password', student_id: forgotStudentId, otp: resetOtp, new_password: resetPassword }),
                  });
                  const data = await res.json();
                  if (!res.ok) { setResetMsg(data.error || 'Erro ao redefinir senha.'); return; }
                  setForgotStep('done');
                } catch {
                  setResetMsg('Erro de conexão. Tente novamente.');
                } finally {
                  setForgotLoading(false);
                }
              }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={lblStyle}>Código de verificação</label>
                  <input type="text" inputMode="numeric" maxLength={6} value={resetOtp} onChange={e => setResetOtp(e.target.value.replace(/\D/g, ''))}
                    style={{ ...inpStyle, textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.5em', fontWeight: 700 }}
                    placeholder="••••••" required autoFocus />
                </div>
                <div>
                  <label style={lblStyle}>Nova Senha <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)}
                    style={{ ...inpStyle, borderColor: resetPassword && resetPassword.length < 6 ? '#fca5a5' : '#2e2e2e' }}
                    placeholder="Mínimo 6 caracteres" minLength={6} required autoFocus />
                  {resetPassword && resetPassword.length < 6 && <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: '#ef4444' }}>Mínimo 6 caracteres</p>}
                </div>
                <div>
                  <label style={lblStyle}>Confirmar Nova Senha <span style={{ color: '#ef4444' }}>*</span></label>
                  <input type="password" value={resetConfirmPassword} onChange={e => setResetConfirmPassword(e.target.value)}
                    style={{ ...inpStyle, borderColor: resetConfirmPassword && resetConfirmPassword !== resetPassword ? '#fca5a5' : resetConfirmPassword && resetConfirmPassword === resetPassword ? '#86efac' : '#2e2e2e' }}
                    placeholder="Repita a nova senha" minLength={6} required />
                  {resetConfirmPassword && resetConfirmPassword !== resetPassword && <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: '#ef4444' }}>As senhas não coincidem</p>}
                  {resetConfirmPassword && resetConfirmPassword === resetPassword && <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: '#4ade80' }}>✓ Senhas coincidem</p>}
                </div>
                <button type="submit" disabled={forgotLoading || resetPassword.length < 6 || resetPassword !== resetConfirmPassword || resetOtp.replace(/\D/g, '').length !== 6}
                  style={{ background: (resetPassword.length >= 6 && resetPassword === resetConfirmPassword && resetOtp.replace(/\D/g, '').length === 6) ? 'linear-gradient(135deg,#FF9200,#c86a00)' : '#2e2e2e', color: (resetPassword.length >= 6 && resetPassword === resetConfirmPassword && resetOtp.replace(/\D/g, '').length === 6) ? '#fff' : '#9ca3af', border: 'none', borderRadius: 10, padding: 13, fontWeight: 700, fontSize: '0.95rem', cursor: forgotLoading ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                  {forgotLoading ? 'Salvando...' : 'Salvar Nova Senha'}
                </button>
              </form>
              <button onClick={async () => {
                // Reenvia o código para os mesmos canais
                if (!forgotInput.trim()) { setForgotStep('lookup'); return; }
                setForgotLoading(true); setResetMsg('');
                try {
                  const res = await fetch('/api/aluno/auth', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'forgot-password', username_or_email: forgotInput }),
                  });
                  const data = await res.json();
                  if (data.send_failed) { setResetMsg('Não foi possível reenviar agora. Procure o admin do seu núcleo.'); }
                } catch { /* mantém na tela */ } finally { setForgotLoading(false); }
              }} style={{ width: '100%', marginTop: 10, background: 'none', border: 'none', color: '#8f8f8f', cursor: 'pointer', fontSize: '0.82rem' }}>Reenviar código</button>
              <button onClick={() => { setForgotStep('lookup'); setResetMsg(''); }} style={{ width: '100%', marginTop: 6, background: 'none', border: 'none', color: '#8f8f8f', cursor: 'pointer', fontSize: '0.82rem' }}>← Usar outro e-mail</button>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 60, height: 60, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, rgba(255,146,0,0.30), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.4)', color: '#FF9200' }}><IconLock size={28} /></span></div>
                <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 700 }}>Recuperar Senha</h2>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#a3a3a3' }}>Informe seu e-mail ou usuário para localizar sua conta.</p>
              </div>
              {forgotMsg && <div style={{ background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: '0.83rem' }}>{forgotMsg}</div>}
              <form onSubmit={async (e) => {
                e.preventDefault();
                setForgotLoading(true); setForgotMsg('');
                try {
                  const res = await fetch('/api/aluno/auth', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'forgot-password', username_or_email: forgotInput }),
                  });
                  const data = await res.json();
                  if (!data.success || !data.student_id) {
                    setForgotMsg('Conta não encontrada. Verifique o e-mail ou usuário informado.');
                  } else if (data.send_failed) {
                    // Sem canal de envio — mostra mensagem de contato do núcleo
                    setForgotMsg('Não foi possível enviar o código agora. Procure o admin do seu núcleo para redefinir sua senha.');
                  } else {
                    setForgotStudentId(data.student_id);
                    setForgotCodeSent(true);
                    setForgotMsg('');
                    setForgotStep('reset');
                  }
                } catch {
                  setForgotMsg('Erro de conexão. Tente novamente.');
                } finally {
                  setForgotLoading(false);
                }
              }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={lblStyle}>E-mail ou usuário da conta</label>
                  <input type="text" value={forgotInput} onChange={e => setForgotInput(e.target.value)}
                    style={inpStyle} placeholder="seu@email.com ou nome de usuário" required autoFocus />
                  <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: '#a3a3a3' }}>
                    Enviaremos um código de verificação para os canais vinculados à sua conta.
                  </p>
                </div>
                <button type="submit" disabled={forgotLoading || !forgotInput.trim()}
                  style={{ background: forgotInput.trim() ? 'linear-gradient(135deg,#FF9200,#c86a00)' : '#2e2e2e', color: forgotInput.trim() ? '#fff' : '#9ca3af', border: 'none', borderRadius: 10, padding: 13, fontWeight: 700, fontSize: '0.95rem', cursor: forgotLoading ? 'not-allowed' : 'pointer' }}>
                  {forgotLoading ? 'Enviando código...' : 'Enviar código de verificação'}
                </button>
              </form>
              <button onClick={() => { setShowForgot(false); setForgotMsg(''); setForgotInput(''); }} style={{ width: '100%', marginTop: 12, background: 'none', border: 'none', color: '#8f8f8f', cursor: 'pointer', fontSize: '0.82rem' }}>← Voltar ao login</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── LOADING / verificando sessão ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="pa-splash" aria-hidden="true" style={{ zIndex: 50 }}>
        <div className="pa-splash-ring">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-portal-aluno.png" alt="" />
        </div>
        <div className="pa-splash-name">Portal <span>Aluno</span></div>
        <div className="pa-splash-bar"><i /></div>
      </div>
    );
  }

  // ── TABS NAVIGATION ───────────────────────────────────────────────────────
  // Perfil só-responsável: sem abas de treino (conta_tipo='responsavel' e o
  // responsável não marcou "também sou aluno" na criação da conta).
  const respOnly = contaTipo === 'responsavel' && !respTambemAluno;
  const tabs: { id: Tab; icon: string; label: string; badge?: boolean }[] = [
    { id: 'dashboard',      icon: '', label: 'Início' },
    { id: 'dados',          icon: '', label: respOnly ? 'Dados da Conta' : 'Meus Dados', badge: !!(student && !respOnly && (!student.nucleo || !student.graduacao || !student.email || (docsAluno && pendencias.some(p => p.campo !== 'termo')))) },
    { id: 'termo',          icon: '', label: 'Termo', badge: !!(student && docsAluno && !respOnly && pendencias.some(p => ['termo', 'nome_responsavel', 'cpf_responsavel'].includes(p.campo))) },
    { id: 'evolucao',       icon: '', label: 'Evolução' },
    { id: 'carteirinha',    icon: '', label: 'Carteirinha' },
    { id: 'presenca',       icon: '', label: 'Presença' },
    { id: 'financeiro',     icon: '', label: 'Financeiro' },
    { id: 'graduacao',      icon: '', label: 'Graduação' },
    { id: 'fotos',          icon: '', label: 'Fotos' },
    { id: 'docs',           icon: '', label: 'Docs' },
    { id: 'justificativas', icon: '', label: 'Justific.' },
    { id: 'playlist',       icon: '', label: 'Playlist' },
    { id: 'conta',          icon: '', label: 'Conta' },
  ].filter((t): t is { id: Tab; icon: string; label: string; badge?: boolean } => !respOnly || !['evolucao', 'carteirinha', 'presenca', 'graduacao', 'playlist'].includes(t.id));
  // Barra inferior: as 4 seções mais usadas + gaveta "Mais" com o restante
  const primaryTabIds: Tab[] = respOnly ? ['dashboard', 'fotos', 'docs', 'conta'] : ['dashboard', 'carteirinha', 'presenca', 'financeiro'];
  const primaryTabs = primaryTabIds.map(id => tabs.find(t => t.id === id)!).filter(Boolean);

  // ── DASHBOARD (LOGGED IN) ─────────────────────────────────────────────────
  const displayName = student?.apelido || student?.nome_social || student?.nome_completo?.split(' ')[0] || 'Aluno';
  const welcomeGreeting = student?.sexo === 'M'
    ? `Seja bem-vindo, ${displayName}`
    : student?.sexo === 'F'
    ? `Seja bem-vinda, ${displayName}`
    : `Seja bem-vindo(a), ${displayName}`;

  return (
    <div className="pa-app" style={{ minHeight: '100vh', background: 'transparent', fontFamily: 'var(--font-sans), system-ui, -apple-system, sans-serif', position: 'relative' }}>

      {/* Fundo ambiente — gradientes radiais sutis (não rola com o conteúdo) */}
      <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: `
        radial-gradient(900px 600px at 85% -10%, rgba(255,146,0,0.13) 0%, transparent 62%),
        radial-gradient(700px 520px at -15% 30%, rgba(255,183,77,0.07) 0%, transparent 60%),
        radial-gradient(800px 600px at 50% 115%, rgba(255,146,0,0.09) 0%, transparent 60%),
        linear-gradient(180deg, #0d0d0f 0%, #08080a 100%)` }} />

      {/* Admin preview banner */}
      {isAdminPreview && (
        <div style={{ position: 'relative', zIndex: 2, background: 'linear-gradient(90deg, rgba(255,146,0,0.22), rgba(255,146,0,0.12))', borderBottom: '1px solid rgba(255,146,0,0.3)', color: '#ffd9a8', fontSize: '0.75rem', padding: '6px 20px', textAlign: 'center', fontWeight: 600, letterSpacing: '0.01em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Modo visualização admin — você está vendo a área do aluno como <strong style={{ marginLeft: 4 }}>{student?.nome_completo || '...'}</strong>
        </div>
      )}

      {/* Header do app — hambúrguer + marca; perfil e saída vivem na sidebar */}
      <header className="glass-nav" style={{
        color: '#fff',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky', top: 0, zIndex: 60,
        borderRadius: '0 0 22px 22px',
        marginBottom: -22,
      }}>
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button onClick={() => setSidebarOpen(true)} aria-label="Abrir menu" aria-expanded={sidebarOpen} className="press"
            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 13, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: '#e5e5e5', cursor: 'pointer' }}>
            <IconMenu size={21} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-portal-aluno.png" alt="" style={{ width: 32, height: 32, borderRadius: 9, display: 'block', filter: 'drop-shadow(0 2px 10px rgba(255,146,0,0.35))' }} />
            <div style={{ fontWeight: 800, fontSize: '0.98rem', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              Portal <span style={{ color: '#FF9200' }}>Aluno</span>
            </div>
          </div>
          {isAdminPreview ? (
            <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,146,0,0.14)', border: '1px solid rgba(255,146,0,0.4)', borderRadius: 9, padding: '7px 11px', color: '#FF9200', fontSize: '0.72rem', fontWeight: 700 }}>
              <IconEye size={14} /> Visualização
            </span>
          ) : (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <NotificationsCenter
                authenticated={!!session}
                onNavigate={destino => setActiveTab(destino as Tab)}
              />
              <button onClick={() => setSidebarOpen(true)} aria-label="Abrir perfil" className="press"
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: '50%', border: '2px solid rgba(255,146,0,0.6)', background: 'rgba(255,146,0,0.12)', color: '#FF9200', cursor: 'pointer', overflow: 'hidden', padding: 0, boxShadow: '0 0 14px rgba(255,146,0,0.25)' }}>
              {student?.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={student.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <IconUser size={19} />
              )}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '26px 16px 122px', position: 'relative', zIndex: 1 }}>

        {/* ── DASHBOARD ── */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {!emConformidade && contaTipo !== 'responsavel' && (
              <div style={{ background: 'linear-gradient(160deg, rgba(255,146,0,0.14) 0%, rgba(255,146,0,0.05) 100%)', border: '1px solid rgba(255,146,0,0.4)', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', boxShadow: '0 0 24px rgba(255,146,0,0.08)' }}>
                <span style={{ display: 'flex', color: '#FF9200', flexShrink: 0, marginTop: 2 }}><IconWarn size={22} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fdba74', marginBottom: 3 }}>Cadastro incompleto</div>
                  <div style={{ fontSize: '0.8rem', color: 'rgba(253,186,116,0.85)', lineHeight: 1.5, marginBottom: 10 }}>
                    Pendência(s): <strong>{pendenciasResumo}</strong>. Sem esses dados, presença, justificativas e solicitações financeiras ficam bloqueadas.
                  </div>
                  <button onClick={() => setActiveTab(pendencias.some(p => p.campo === 'termo') ? 'termo' : 'dados')} className="press"
                    style={{ background: 'linear-gradient(135deg, #ffb84d 0%, #FF9200 55%, #f07f00 100%)', color: '#141414', border: 'none', borderRadius: 10, padding: '8px 16px', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer', boxShadow: '0 4px 16px rgba(255,146,0,0.35)' }}>
                    Completar cadastro
                  </button>
                </div>
              </div>
            )}

            {acessandoComoTutelado && perfilAtivoInfo && (
              <div style={{ background: 'rgba(96,165,250,0.10)', border: '1px solid rgba(96,165,250,0.35)', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'flex', color: '#93c5fd', flexShrink: 0 }}><IconUser size={18} /></span>
                <div style={{ flex: 1, fontSize: '0.8rem', color: '#93c5fd', lineHeight: 1.5 }}>
                  Você está acessando como <strong>{perfilAtivoInfo.nome_completo}</strong> (perfil de dependente). Ações em nome dele ficam registradas na sua conta.
                </div>
                <button onClick={() => trocarPerfil(session!.student_id)} className="press" style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.35)', color: '#93c5fd', borderRadius: 9, padding: '6px 12px', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                  Voltar ao meu perfil
                </button>
              </div>
            )}

            {conformidadeAviso && (
              <div style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'flex', color: '#fca5a5', flexShrink: 0 }}><IconLock size={18} /></span>
                <div style={{ flex: 1, fontSize: '0.8rem', color: '#fca5a5', lineHeight: 1.5 }}>{conformidadeAviso}</div>
                <button onClick={() => setConformidadeAviso('')} aria-label="Dispensar aviso" style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', flexShrink: 0, padding: 4 }}>
                  <IconX size={16} />
                </button>
              </div>
            )}

            {student && (student.menor_de_idade as boolean) && !student.assinatura_responsavel && (
              <div style={{ background: 'linear-gradient(160deg, rgba(239,68,68,0.13) 0%, rgba(239,68,68,0.05) 100%)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 16, padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
                <span style={{ display: 'flex', color: '#fca5a5', flexShrink: 0, marginTop: 2 }}><IconWarn size={22} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fca5a5', marginBottom: 3 }}>Termo de Responsabilidade pendente</div>
                  <div style={{ fontSize: '0.8rem', color: 'rgba(254,202,202,0.8)', lineHeight: 1.5, marginBottom: 10 }}>
                    Como aluno menor de idade, o termo de autorização ainda não foi assinado.
                  </div>
                  <button onClick={() => setActiveTab('termo')} className="press"
                    style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.85), rgba(185,28,28,0.85))', color: '#fff', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 10, padding: '8px 16px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                    Assinar Termo
                  </button>
                </div>
              </div>
            )}

            {/* Welcome card premium — glassmorphism com borda em degradê */}
            <div style={{
              borderRadius: 26, padding: 1.2, position: 'relative',
              background: 'linear-gradient(140deg, rgba(255,146,0,0.55) 0%, rgba(255,255,255,0.10) 36%, rgba(255,255,255,0.06) 64%, rgba(255,183,77,0.42) 100%)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 0 36px rgba(255,146,0,0.10)',
            }}>
            <div className="glass" style={{ borderRadius: 25, padding: '22px 20px 18px', color: '#fff', position: 'relative', overflow: 'hidden' }}>
              <div aria-hidden="true" style={{ position: 'absolute', top: -90, right: -60, width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,146,0,0.20) 0%, rgba(255,146,0,0) 68%)', pointerEvents: 'none' }} />
              <div aria-hidden="true" style={{ position: 'absolute', bottom: -110, left: -70, width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,183,77,0.10) 0%, rgba(255,183,77,0) 70%)', pointerEvents: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 16, position: 'relative' }}>
                <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}>
                  {student?.foto_url ? (
                    <>
                      <span aria-hidden="true" style={{ position: 'absolute', inset: -7, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,146,0,0.45) 0%, rgba(255,146,0,0) 72%)', filter: 'blur(6px)' }} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={student.foto_url} alt={displayName} style={{ position: 'relative', width: 62, height: 62, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,146,0,0.65)', boxShadow: '0 6px 20px rgba(0,0,0,0.5)' }} />
                    </>
                  ) : (
                    <span style={{ width: 62, height: 62, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, rgba(255,146,0,0.32), rgba(255,146,0,0.10))', border: '1.5px solid rgba(255,146,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="38" height="38" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="32" cy="10" r="7" fill="rgba(255,255,255,0.9)"/>
                        <path d="M32 17 C26 20 22 28 24 36 L20 54" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" strokeLinecap="round"/>
                        <path d="M32 17 C38 20 42 28 40 36 L44 54" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" strokeLinecap="round"/>
                        <path d="M24 36 L14 44" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" strokeLinecap="round"/>
                        <path d="M40 36 L50 32" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" strokeLinecap="round"/>
                      </svg>
                    </span>
                  )}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.64rem', color: 'rgba(255,146,0,0.95)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span aria-hidden="true" style={{ width: 16, height: 1.5, borderRadius: 1, background: 'linear-gradient(90deg, rgba(255,146,0,0.9), rgba(255,146,0,0))' }} />
                    Portal Aluno
                  </div>
                  <div style={{ fontSize: '1.28rem', fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.01em', textShadow: '0 1px 18px rgba(255,146,0,0.16)' }}>{welcomeGreeting}</div>
                  {student?.apelido && student.nome_completo && student.apelido !== student.nome_completo.split(' ')[0] && (
                    <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{student.nome_completo}</div>
                  )}
                </div>
              </div>
              {/* Identity strip */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, position: 'relative' }}>
                {respOnly ? (
                  <>
                    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '9px 12px' }}>
                      <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Nome Completo</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2 }}>{student?.nome_completo || '—'}</div>
                    </div>
                    <div style={{ background: 'rgba(255,146,0,0.07)', border: '1px solid rgba(255,146,0,0.25)', borderRadius: 12, padding: '9px 12px' }}>
                      <div style={{ fontSize: '0.6rem', color: 'rgba(255,146,0,0.8)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Minha Conta</div>
                      <div style={{ fontSize: '0.86rem', fontWeight: 800, color: '#ffb84d' }}>Responsável</div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '9px 12px', gridColumn: '1 / -1' }}>
                      <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>E-mail</div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student?.email || '—'}</div>
                    </div>
                  </>
                ) : (
                <>
                <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '9px 12px' }}>
                  <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Nome Completo</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, lineHeight: 1.2 }}>{student?.nome_completo || '—'}</div>
                </div>
                <div style={{ background: 'rgba(255,146,0,0.07)', border: '1px solid rgba(255,146,0,0.25)', borderRadius: 12, padding: '9px 12px' }}>
                  <div style={{ fontSize: '0.6rem', color: 'rgba(255,146,0,0.8)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Meu ID</div>
                  <div style={{ fontSize: '0.86rem', fontWeight: 800, letterSpacing: '0.1em', color: '#ffb84d', textShadow: '0 0 12px rgba(255,146,0,0.35)' }}>{alunoInscricaoNum != null ? `CCLN-${String(alunoInscricaoNum).padStart(3, '0')}` : (student ? 'Gerando…' : '—')}</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '9px 12px' }}>
                  <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Graduação</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ display: 'inline-flex', height: 12, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.45)', flexShrink: 0, minWidth: 28, boxShadow: '0 0 10px rgba(255,255,255,0.08)' }}>
                      {cordaColors.map((c: string, i: number) => (
                        <span key={i} style={{ flex: 1, background: c === '#FFFFFF' ? '#e5e7eb' : c }} />
                      ))}
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>{student?.graduacao || 'Não informada'}</span>
                  </div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '9px 12px' }}>
                  <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Núcleo</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>{student?.nucleo || 'CCLN'}</div>
                </div>
                </>
                )}
              </div>
              {/* ── Painel de dependentes (conta só-responsável) ── */}
              {respOnly && (
                <div style={{ marginTop: 10, background: 'linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>Meus dependentes</div>
                    <button onClick={() => setActiveTab('conta')} className="press"
                      style={{ background: 'linear-gradient(135deg, #ffb84d 0%, #FF9200 55%, #f07f00 100%)', color: '#141414', border: 'none', borderRadius: 9, padding: '6px 12px', fontWeight: 800, fontSize: '0.74rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      + Criar perfil / vincular
                    </button>
                  </div>
                  {dependentes.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.76rem', color: '#8f8f8f', lineHeight: 1.5 }}>
                      Nenhum dependente vinculado ainda. Toque em “+ Criar perfil / vincular” para cadastrar quem você representa (até 14 anos) ou vincular um aluno que já tem cadastro.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {dependentes.map(d => (
                        <div key={d.student_id} style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 11, padding: '8px 10px' }}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,146,0,0.12)', color: '#FF9200', flexShrink: 0, overflow: 'hidden' }}>
                            {d.foto_url
                              ? // eslint-disable-next-line @next/next/no-img-element
                                <img src={d.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <IconUser size={15} />}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#f5f5f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.nome_completo}</span>
                            <span style={{ display: 'block', fontSize: '0.66rem', color: '#8f8f8f', fontWeight: 600 }}>
                              {d.idade != null ? `${d.idade} anos` : ''}{d.nucleo ? ` · ${d.nucleo}` : ''}
                            </span>
                          </span>
                          <span style={{
                            fontSize: '0.62rem', fontWeight: 800, padding: '3px 8px', borderRadius: 999,
                            background: d.status_vinculo === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(234,179,8,0.12)',
                            color: d.status_vinculo === 'active' ? '#4ade80' : '#facc15',
                            textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0,
                          }}>
                            {d.status_vinculo === 'active' ? 'Ativo' : 'Pendente'}
                          </span>
                          <button onClick={() => { setPerfilLoading(true); trocarPerfil(d.student_id).finally(() => setPerfilLoading(false)); }} disabled={perfilLoading || d.status_vinculo !== 'active'} className="press"
                            style={{ background: 'rgba(255,146,0,0.10)', border: '1px solid rgba(255,146,0,0.35)', color: '#ffb84d', borderRadius: 9, padding: '5px 10px', fontSize: '0.7rem', fontWeight: 800, cursor: d.status_vinculo === 'active' ? 'pointer' : 'not-allowed', opacity: d.status_vinculo === 'active' ? 1 : 0.5, flexShrink: 0 }}>
                            Abrir
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* ── Banner cadastro incompleto ── */}
              {cadastroIncompleto && (
                <div style={{ marginTop: 14, borderRadius: 15, overflow: 'hidden', border: '1px solid rgba(239,68,68,0.42)', background: 'linear-gradient(160deg, rgba(239,68,68,0.14) 0%, rgba(239,68,68,0.05) 100%)', boxShadow: '0 10px 30px rgba(0,0,0,0.35)', position: 'relative', animation: 'pulseCard 1.6s ease-in-out infinite' }}>
                  <style>{`
                    @keyframes pulseCard { 0%,100%{box-shadow:0 10px 30px rgba(0,0,0,0.35),0 0 0 0 rgba(239,68,68,0.35)} 50%{box-shadow:0 10px 34px rgba(0,0,0,0.4),0 0 0 7px rgba(239,68,68,0)} }
                    @keyframes sirenBlink { 0%,100%{opacity:1} 50%{opacity:0.2} }
                    @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
                  `}</style>
                  <div style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(239,68,68,0.25)' }}>
                    <span style={{ animation: 'sirenBlink 0.7s ease-in-out infinite', display: 'flex', color: '#fca5a5' }}><IconWarn size={15} /></span>
                    <span style={{ fontWeight: 800, fontSize: '0.78rem', color: '#fecaca', letterSpacing: '0.08em', flex: 1 }}>CADASTRO INCOMPLETO</span>
                    <span style={{ animation: 'sirenBlink 0.7s ease-in-out infinite 0.35s', display: 'flex', color: '#fca5a5' }}><IconWarn size={15} /></span>
                  </div>
                  <div style={{ padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fee2e2', marginBottom: 3 }}>
                        Seus dados estão incompletos!
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'rgba(254,202,202,0.75)', lineHeight: 1.5 }}>
                        Preencha os dados obrigatórios: núcleo, graduação, data de nascimento, telefone, e-mail, sexo e autorização de uso de imagem.
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ display: 'flex', justifyContent: 'center', color: '#f87171', animation: 'bounce 1s ease-in-out infinite' }}><IconWarn size={18} /></span>
                      <button
                        onClick={() => setActiveTab('dados')}
                        style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.85), rgba(185,28,28,0.85))', color: '#fff', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 10, padding: '8px 15px', fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(239,68,68,0.3)' }}>
                        Completar agora
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            </div>

            {/* ── Mural de avisos ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <SectionLabel icon={<IconBell size={13} />}>Mural</SectionLabel>
              {muralLoading ? (
                <div style={{ textAlign: 'center', color: '#8f8f8f', fontSize: '0.8rem', padding: '18px 0' }}>Carregando avisos...</div>
              ) : muralItems.length === 0 ? (
                <div className="glass-soft" style={{ textAlign: 'center', padding: '20px 16px', borderStyle: 'dashed', borderRadius: 16, color: '#8f8f8f', fontSize: '0.8rem', lineHeight: 1.5 }}>
                  Sem avisos no momento.<br />Comunicados dos instrutores aparecem aqui.
                </div>
              ) : (
                muralItems.slice(0, 6).map(item => (
                  <div key={item.id} className="glass-soft" style={{ borderRadius: 18, overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 14px 0', flexWrap: 'wrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,146,0,0.10)', border: '1px solid rgba(255,146,0,0.28)', color: '#fdba74', borderRadius: 7, padding: '2.5px 8px', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {item.tipo === 'cartaz' ? <IconImage size={10} /> : <IconBell size={10} />}
                        {item.tipo === 'cartaz' ? 'Cartaz' : 'Aviso'}
                      </span>
                      {item.nucleo && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#a3a3a3', borderRadius: 7, padding: '2.5px 8px', fontSize: '0.6rem', fontWeight: 700 }}>
                          <IconMapPin size={10} /> {item.nucleo}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: '0.64rem', color: '#6b6b6b' }}>
                        {new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      </span>
                    </div>
                    <div style={{ padding: '8px 14px 13px' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f5f5f4', lineHeight: 1.3 }}>{item.titulo}</div>
                      {item.texto && <div style={{ fontSize: '0.8rem', color: '#c9c9c9', lineHeight: 1.55, marginTop: 5, whiteSpace: 'pre-wrap' }}>{item.texto}</div>}
                      {item.tipo === 'cartaz' && item.imagem_path && (
                        muralUrls[item.imagem_path] ? (
                          <a href={muralUrls[item.imagem_path]} target="_blank" rel="noopener noreferrer" style={{ display: 'block', marginTop: 10, borderRadius: 13, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)' }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={muralUrls[item.imagem_path]} alt={item.titulo} loading="lazy"
                              style={{ width: '100%', display: 'block', maxHeight: 380, objectFit: 'cover' }} />
                          </a>
                        ) : (
                          <div style={{ marginTop: 10, height: 130, borderRadius: 13, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a5a5a' }}>
                            <IconImage size={22} />
                          </div>
                        )
                      )}
                      <div style={{ marginTop: 8, fontSize: '0.66rem', color: '#6b6b6b' }}>Publicado por {item.autor}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* ── Frequência individual (gráfico) ── */}
            <FrequenciaCard studentId={session?.student_id || ''} cordaColors={cordaColors} graduacao={student?.graduacao} />

            {/* Próximos eventos */}
            {eventos.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SectionLabel icon={<IconClock size={13} />}>Próximos Eventos</SectionLabel>
                {eventos.slice(0, 3).map((ev: any) => (
                  <div key={ev.id} className="glass-soft" style={{ borderRadius: 16, padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 13, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.28), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.3)', color: '#FF9200', flexShrink: 0, boxShadow: '0 0 16px rgba(255,146,0,0.16)' }}>
                      <IconBerimbau size={21} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f5f5f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.nome}</div>
                      <div style={{ fontSize: '0.75rem', color: '#a3a3a3', marginTop: 2 }}>
                        {ev.data ? new Date(ev.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                        {ev.hora ? ` · ${ev.hora}` : ''}
                        {ev.local ? ` · ${ev.local}` : ''}
                      </div>
                    </div>
                    <span style={{ flexShrink: 0, background: 'rgba(255,146,0,0.10)', border: '1px solid rgba(255,146,0,0.28)', color: '#fdba74', borderRadius: 8, padding: '3px 9px', fontSize: '0.7rem', fontWeight: 700 }}>
                      {ev.tipo === 'batizado' ? 'Batizado' : ev.tipo === 'troca' ? 'Troca' : 'Evento'}
                    </span>
                  </div>
                ))}
                {eventos.length > 3 && (
                  <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#8f8f8f' }}>+{eventos.length - 3} evento(s) — veja na aba Graduação</div>
                )}
              </div>
            )}

            {/* Links institucionais */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SectionLabel icon={<IconFolder size={13} />}>Institucional</SectionLabel>
              {([
                { href: '/hierarquia', Icon: IconMedal, label: 'Hierarquia' },
                { href: '/organograma', Icon: IconFolder, label: 'Organograma' },
                { href: '/documentos', Icon: IconDoc, label: 'Documentos Históricos da Capoeira' },
              ] as const).map(({ href, Icon, label }) => (
                <a key={href} href={href} className="press"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, borderRadius: 15, padding: '12px 14px', textDecoration: 'none', border: '1px solid rgba(255,255,255,0.07)', background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 12, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.26), rgba(255,146,0,0.07))', border: '1px solid rgba(255,146,0,0.28)', color: '#FF9200', flexShrink: 0 }}>
                    <Icon size={18} />
                  </span>
                  <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 700, color: '#e5e5e5' }}>{label}</span>
                  <span style={{ display: 'flex', color: '#6b6b6b' }}><IconChevron size={16} /></span>
                </a>
              ))}
            </div>

            {/* Documentos institucionais vivem em painel dedicado (/documentos) — removido da home */}
          </div>
        )}

        {/* ── CARTEIRINHA ── */}
        {activeTab === 'carteirinha' && cartData && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionTitle icon={<IconIdCard size={17} />}>Minha Carteirinha</SectionTitle>
            <div ref={carteirinhaRef} style={{ display: 'flex', justifyContent: 'center' }}>
              <Carteirinha data={cartData} />
            </div>

            {/* Action buttons */}
            <button
              onClick={() => {
                const printArea = carteirinhaRef.current;
                if (!printArea) return;
                const w = window.open('', '_blank', 'width=600,height=450');
                if (!w) return;
                w.document.write(`<html><head><title>Carteirinha - ${cartData.nome}</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f1f5f9;font-family:Inter,sans-serif}@media print{body{background:#fff}}</style></head><body>${printArea.innerHTML}</body></html>`);
                w.document.close();
                w.focus();
                setTimeout(() => { w.print(); }, 400);
              }}
              style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg,#1a1a2e,#0f3460)', border: '1px solid rgba(220,38,38,0.4)', color: '#fff', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Imprimir / Salvar PDF
            </button>
            <button
              onClick={() => {
                const phone = (student?.telefone || '').replace(/\D/g, '');
                const br = phone.startsWith('55') ? phone : `55${phone}`;
                const base = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
                const cpfEnc = encodeURIComponent(cartData.cpf || '');
                const url = `${base}/carteirinha${cpfEnc ? `?cpf=${cpfEnc}` : ''}`;
                const msg = encodeURIComponent(`🎖️ *Carteirinha - Sistema de Gestao*\n\nOlá, *${cartData.nome}*! Sua carteirinha de associado está disponível:\n\n🔗 ${url}\n\n_Portal Aluno_`);
                window.open(phone.length >= 10 ? `https://api.whatsapp.com/send?phone=${br}&text=${msg}` : `https://api.whatsapp.com/send?text=${msg}`, '_blank');
              }}
              style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg,rgba(37,211,102,0.15),rgba(37,211,102,0.08))', border: '1px solid rgba(37,211,102,0.4)', color: '#25d366', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
              Compartilhar via WhatsApp
            </button>
            <div style={{ background: 'rgba(14,165,233,0.10)', borderRadius: 12, padding: '12px 16px', border: '1px solid rgba(14,165,233,0.35)', fontSize: '0.78rem', color: '#7dd3fc' }}>
              Use esta carteirinha para identificação nas aulas. Você pode imprimir ou salvar como PDF.
            </div>
          </div>
        )}

        {/* ── PRESENÇA ── */}
        {activeTab === 'presenca' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionTitle icon={<IconMapPin size={17} />}>Registrar Presença</SectionTitle>

            <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '24px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.05)', textAlign: 'center' }}>
              <div style={{ color: '#FF9200', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><IconMapPin size={52} strokeWidth={1.6} /></div>
              <h3 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 700, color: '#f5f5f4' }}>Presença do dia de hoje</h3>
              <p style={{ margin: '0 0 20px', fontSize: '0.83rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                Sua presença será registrada automaticamente ao clicar no botão abaixo.<br />
                Você precisa estar no local de treino (raio de 200m).
              </p>

              {/* Local de treino */}
              {student?.nucleo && (
                <div style={{ textAlign: 'left', marginBottom: 18 }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#d4d4d4', marginBottom: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconFolder size={13} /> Seu Núcleo</span>
                  </label>
                  <div style={{ background: 'rgba(255,255,255,0.05)', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.88rem', color: '#f5f5f4', fontWeight: 600 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconMapPin size={12} /> {student.nucleo}</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#a3a3a3', marginTop: 4, fontWeight: 400 }}>
                    A presença é registrada sempre no seu núcleo de cadastro.
                  </div>
                </div>
              )}

              {!student?.nucleo && (
                <div style={{ background: 'rgba(239,68,68,0.09)', border: '1.5px solid rgba(239,68,68,0.4)', borderRadius: 12, padding: '14px 16px', marginBottom: 18, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 800, color: '#fca5a5', marginBottom: 4 }}><IconWarn size={14} /> Presença bloqueada</div>
                  <div style={{ fontSize: '0.78rem', color: '#b91c1c', lineHeight: 1.5 }}>
                    Você ainda não está vinculado a um núcleo. Escolha seu núcleo na aba <strong>Meus Dados</strong> para destravar o registro de presença.
                  </div>
                </div>
              )}

              {presencaMsg && (
                <div style={{ background: presencaStatus === 'success' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)', border: `1px solid ${presencaStatus === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`, color: presencaStatus === 'success' ? '#86efac' : '#fca5a5', borderRadius: 12, padding: '12px 16px', marginBottom: 18, fontSize: '0.85rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {presencaStatus === 'success' ? <IconCheck size={15} /> : <IconWarn size={15} />}{presencaMsg}
                </div>
              )}

              <button onClick={handlePresenca} disabled={presencaLoading}
                style={{ background: presencaLoading ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg, #ffb84d 0%, #FF9200 55%, #f07f00 100%)', color: presencaLoading ? '#a3a3a3' : '#141414', border: presencaLoading ? '1px solid rgba(255,255,255,0.09)' : 'none', borderRadius: 15, padding: '16px 32px', fontWeight: 800, fontSize: '1rem', cursor: presencaLoading ? 'not-allowed' : 'pointer', boxShadow: presencaLoading ? 'none' : '0 8px 26px rgba(255,146,0,0.4), 0 0 18px rgba(255,146,0,0.25)', transition: 'all 0.2s' }}>
                {presencaLoading ? 'Obtendo localização...' : 'Registrar Presença Agora'}
              </button>

              <p style={{ margin: '14px 0 0', fontSize: '0.72rem', color: '#8f8f8f' }}>
                A localização é usada apenas para confirmar que você está no local de treino e não é armazenada.
              </p>
            </div>

            <div style={{ background: 'rgba(255,146,0,0.08)', borderRadius: 12, padding: '12px 16px', border: '1px solid rgba(255,146,0,0.28)', fontSize: '0.8rem', color: '#fdba74', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconWarn size={13} /> O registro de presença só pode ser feito no dia atual.</span> Se precisar justificar uma falta, use a aba <strong>Justificativas</strong>.
            </div>
          </div>
        )}

        {/* ── FINANCEIRO ── */}
        {activeTab === 'financeiro' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <SectionTitle icon={<IconWallet size={17} />}>Ficha Financeira</SectionTitle>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { if (!session) return; setFichaFinLoading(true); fetch(`/api/financeiro?student_id=${alvoPerfil}`).then(r=>r.json()).then(d=>{setFichaFin(d);setFichaFinLoading(false);}).catch(()=>setFichaFinLoading(false)); }}
                  style={{ background: 'none', border: '1px solid rgba(255,146,0,0.45)', color: '#FF9200', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}><IconRefresh size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }} />Atualizar</button>
                <a href={`/financeiro?student_id=${alvoPerfil}`} target="_blank" rel="noreferrer"
                  style={{ background: 'linear-gradient(135deg,#16a34a,#15803d)', color: '#fff', textDecoration: 'none', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600 }}>↗ Portal completo</a>
              </div>
            </div>

            {fichaFinLoading && <div style={{ textAlign: 'center', padding: '32px 0', color: '#8f8f8f' }}>Carregando...</div>}

            {/* ── Ações: Solicitar Batizado / Uniforme ── */}
            {!fichaFinLoading && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {/* Solicitar Batizado — só se ainda não tem modalidade */}
                {(!fichaFin || (fichaFin as any)?.batizado?.modalidade === 'nao_definido' || !(fichaFin as any)?.batizado) && (
                  <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: `1.5px solid ${showSolBatizado ? '#7c3aed' : '#2e2e2e'}`, borderRadius: 14, padding: '14px 16px', flex: 1, minWidth: 240 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#c4b5fd', marginBottom: showSolBatizado ? 12 : 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconMedal size={14} /> Solicitar Batizado</span>
                      <button onClick={() => { setShowSolBatizado(v=>!v); setSolBatizadoMsg(''); }}
                        style={{ background: showSolBatizado ? 'rgba(124,58,237,0.12)' : 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.3)', color: '#c4b5fd', borderRadius: 8, padding: '3px 12px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
                        {showSolBatizado ? '✕ Fechar' : '+ Solicitar'}
                      </button>
                    </div>
                    {!showSolBatizado && <div style={{ fontSize: '0.78rem', color: '#8f8f8f', marginTop: 4 }}>Participe do próximo batizado/troca de graduação.</div>}
                    {showSolBatizado && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 4 }}>Forma de pagamento</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {(['integral','parcelado'] as const).map(m => (
                              <button key={m} onClick={() => setSolBatizadoModalidade(m)}
                                style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: `1.5px solid ${solBatizadoModalidade === m ? '#7c3aed' : '#2e2e2e'}`, background: solBatizadoModalidade === m ? 'rgba(124,58,237,0.08)' : '#141414', color: solBatizadoModalidade === m ? '#7c3aed' : '#6b7280', fontWeight: solBatizadoModalidade === m ? 700 : 500, cursor: 'pointer', fontSize: '0.8rem' }}>
                                {m === 'integral' ? 'À vista' : 'Parcelado'}
                              </button>
                            ))}
                          </div>
                        </div>
                        {solBatizadoModalidade === 'parcelado' && (
                          <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 4 }}>Número de parcelas</label>
                            <input type="number" min={2} max={12} value={solBatizadoParcelas} onChange={e => setSolBatizadoParcelas(Math.max(2, Math.min(12, parseInt(e.target.value)||2)))}
                              style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.85rem', outline: 'none' }} />
                          </div>
                        )}
                        {solBatizadoMsg && <div style={{ fontSize: '0.78rem', color: solBatizadoMsg.startsWith('✓') ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{solBatizadoMsg}</div>}
                        <button disabled={solBatizadoSaving} onClick={async () => {
                          if (!session) return;
                          if (!exigirConformidade(pendencias.some(p => p.campo === 'termo') ? 'termo' : 'dados')) return;
                          setSolBatizadoSaving(true); setSolBatizadoMsg('');
                          try {
                            const getRes = await fetch(`/api/financeiro?student_id=${alvoPerfil}`);
                            const { data: fd } = await getRes.json();
                            const ficha = fd || {};
                            const batizado = {
                              ...(ficha.batizado || {}),
                              modalidade: solBatizadoModalidade,
                              status_geral: 'pendente',
                              parcelas: solBatizadoModalidade === 'integral' ? (ficha.batizado?.parcelas?.length ? ficha.batizado.parcelas : [{ numero: 1, valor: ficha.batizado?.valor_total || 0, status: 'pendente', vencimento: '' }]) : Array.from({ length: solBatizadoParcelas }, (_, i) => ({ numero: i+1, valor: 0, status: 'pendente', vencimento: '' })),
                            };
                            const updated = { ...ficha, batizado, student_id: alvoPerfil };
                            const saveRes = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
                            if (!saveRes.ok) throw new Error();
                            setSolBatizadoMsg('Solicitação enviada! O administrador irá configurar os valores.');
                            setFichaFinLoading(true);
                            fetch(`/api/financeiro?student_id=${alvoPerfil}`).then(r=>r.json()).then(d=>{setFichaFin(d);setFichaFinLoading(false);}).catch(()=>setFichaFinLoading(false));
                            setShowSolBatizado(false);
                          } catch { setSolBatizadoMsg('Erro ao enviar solicitação. Tente novamente.'); }
                          setSolBatizadoSaving(false);
                        }} style={{ padding: '8px 0', background: solBatizadoSaving ? '#2e2e2e' : 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: solBatizadoSaving ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
                          {solBatizadoSaving ? 'Enviando...' : 'Enviar Solicitação'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Solicitar Uniforme */}
                <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: `1.5px solid ${showSolUniforme ? '#d97706' : '#2e2e2e'}`, borderRadius: 14, padding: '14px 16px', flex: 1, minWidth: 240 }}>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#fb923c', marginBottom: showSolUniforme ? 12 : 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconBag size={14} /> Solicitar Uniforme</span>
                    <button onClick={() => {
                      setShowSolUniforme(v=>!v); setSolUnifMsg('');
                      // Pré-preenche com as medidas já salvas no cadastro (admin ou solicitação anterior)
                      if (!showSolUniforme) {
                        const su = student as Record<string, string | null | undefined> | null;
                        setSolUnifMedidas(p => ({
                          camisaTamanho: p.camisaTamanho   || String(su?.uniforme_camisa_tamanho || ''),
                          altura:        p.altura          || String(su?.uniforme_calca_altura   || ''),
                          cintura:       p.cintura         || String(su?.uniforme_calca_cintura  || ''),
                          gaviao:        p.gaviao          || String(su?.uniforme_calca_gaviao   || ''),
                          camisaGrupo:   p.camisaGrupo     || String(su?.uniforme_camisa_grupo   || ''),
                          camisaProjeto: p.camisaProjeto   || String(su?.uniforme_camisa_projeto || ''),
                        }));
                      }
                    }}
                      style={{ background: showSolUniforme ? 'rgba(217,119,6,0.12)' : 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', color: '#fb923c', borderRadius: 8, padding: '3px 12px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700 }}>
                      {showSolUniforme ? '✕ Fechar' : '+ Solicitar'}
                    </button>
                  </div>
                  {!showSolUniforme && <div style={{ fontSize: '0.78rem', color: '#8f8f8f', marginTop: 4 }}>Solicite camisetas, bermudas e outros itens.</div>}
                  {showSolUniforme && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 4 }}>Item</label>
                        <input value={solUnifItem} onChange={e => setSolUnifItem(e.target.value)} placeholder="Ex: Camiseta, Bermuda..."
                          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 4 }}>Tamanho</label>
                          <select value={solUnifTam} onChange={e => setSolUnifTam(e.target.value)}
                            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 8px', fontSize: '0.85rem', outline: 'none' }}>
                            {['PP','P','M','G','GG','XGG'].map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div style={{ width: 80 }}>
                          <label style={{ display: 'block', fontSize: '0.75rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 4 }}>Qtd.</label>
                          <input type="number" min={1} max={10} value={solUnifQtd} onChange={e => setSolUnifQtd(Math.max(1, parseInt(e.target.value)||1))}
                            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 8px', fontSize: '0.85rem', outline: 'none' }} />
                        </div>
                      </div>
                      {solUnifMsg && <div style={{ fontSize: '0.78rem', color: solUnifMsg.startsWith('✓') ? '#16a34a' : '#dc2626', fontWeight: 600 }}>{solUnifMsg}</div>}
                      {(() => {
                        // Medidas do uniforme — gravadas automaticamente no cadastro
                        // do aluno quando a solicitação é enviada.
                        const unif = solUnifMedidas;
                        return (
                          <div style={{ background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fb923c' }}>Medidas para confecção do uniforme</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 3 }}>Camisa — tamanho</label>
                                <input value={unif.camisaTamanho} onChange={e => setSolUnifMedidas(p => ({ ...p, camisaTamanho: e.target.value }))} placeholder="Ex: M"
                                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 3 }}>Altura</label>
                                <input value={unif.altura} onChange={e => setSolUnifMedidas(p => ({ ...p, altura: e.target.value }))} placeholder="Ex: 1,70 m"
                                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 3 }}>Cintura</label>
                                <input value={unif.cintura} onChange={e => setSolUnifMedidas(p => ({ ...p, cintura: e.target.value }))} placeholder="Ex: 78 cm"
                                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 3 }}>Gavião</label>
                                <input value={unif.gaviao} onChange={e => setSolUnifMedidas(p => ({ ...p, gaviao: e.target.value }))} placeholder="Ex: 96 cm"
                                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 3 }}>Camisa do Grupo (tamanho)</label>
                                <input value={unif.camisaGrupo} onChange={e => setSolUnifMedidas(p => ({ ...p, camisaGrupo: e.target.value }))} placeholder="Ex: M"
                                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }} />
                              </div>
                              <div>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: '#d4d4d4', fontWeight: 600, marginBottom: 3 }}>Camisa do Projeto (tamanho)</label>
                                <input value={unif.camisaProjeto} onChange={e => setSolUnifMedidas(p => ({ ...p, camisaProjeto: e.target.value }))} placeholder="Ex: M"
                                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' }} />
                              </div>
                            </div>
                            <div style={{ fontSize: '0.68rem', color: '#8f8f8f' }}>Ficam salvas no cadastro — o admin finaliza o pedido no painel.</div>
                          </div>
                        );
                      })()}
                      <button disabled={solUnifSaving || !solUnifItem.trim()} onClick={async () => {
                        if (!session || !solUnifItem.trim()) return;
                        if (!exigirConformidade(pendencias.some(p => p.campo === 'termo') ? 'termo' : 'dados')) return;
                        setSolUnifSaving(true); setSolUnifMsg('');
                        try {
                          const getRes = await fetch(`/api/financeiro?student_id=${alvoPerfil}`);
                          const { data: fd } = await getRes.json();
                          const ficha = fd || {};
                          const novoItem = { id: Date.now().toString(), descricao: `${solUnifItem.trim()} | ${solUnifTam} | ${solUnifQtd}`, tamanho: solUnifTam, quantidade: solUnifQtd, valor_unitario: 0, status: 'solicitado', data_pedido: new Date().toISOString().slice(0,10) };
                          const updated = { ...ficha, uniformes: [...(ficha.uniformes || []), novoItem], student_id: alvoPerfil };
                          const saveRes = await fetch('/api/financeiro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
                          if (!saveRes.ok) throw new Error();
                          // Medidas informadas na solicitação são gravadas no cadastro
                          // (colunas uniforme_*) — só atualiza o que veio preenchido.
                          const med: Record<string, string> = {};
                          if (solUnifMedidas.camisaTamanho.trim()) med.uniforme_camisa_tamanho = solUnifMedidas.camisaTamanho.trim();
                          if (solUnifMedidas.altura.trim())        med.uniforme_calca_altura = solUnifMedidas.altura.trim();
                          if (solUnifMedidas.cintura.trim())       med.uniforme_calca_cintura = solUnifMedidas.cintura.trim();
                          if (solUnifMedidas.gaviao.trim())        med.uniforme_calca_gaviao = solUnifMedidas.gaviao.trim();
                          if (solUnifMedidas.camisaGrupo.trim())   med.uniforme_camisa_grupo = solUnifMedidas.camisaGrupo.trim();
                          if (solUnifMedidas.camisaProjeto.trim()) med.uniforme_camisa_projeto = solUnifMedidas.camisaProjeto.trim();
                          if (Object.keys(med).length > 0) {
                            try { await fetch('/api/aluno/dados', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id: alvoPerfil, ...med }) }); } catch { /* não bloqueia a solicitação */ }
                          }
                          setSolUnifMsg('Solicitação enviada!');
                          setSolUnifItem(''); setSolUnifTam('M'); setSolUnifQtd(1);
                          setFichaFinLoading(true);
                          fetch(`/api/financeiro?student_id=${alvoPerfil}`).then(r=>r.json()).then(d=>{setFichaFin(d);setFichaFinLoading(false);}).catch(()=>setFichaFinLoading(false));
                          setShowSolUniforme(false);
                        } catch { setSolUnifMsg('Erro ao enviar solicitação. Tente novamente.'); }
                        setSolUnifSaving(false);
                      }} style={{ padding: '8px 0', background: (solUnifSaving || !solUnifItem.trim()) ? '#2e2e2e' : 'linear-gradient(135deg,#d97706,#b45309)', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: (solUnifSaving || !solUnifItem.trim()) ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
                        {solUnifSaving ? 'Enviando...' : 'Enviar Solicitação'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {!fichaFinLoading && !fichaFin && (
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '28px 20px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#6b6b6b' }}><IconNote size={26} /></span></div>
                <div style={{ fontWeight: 700, color: '#d4d4d4', marginBottom: 4 }}>Nenhuma informação financeira registrada</div>
                <div style={{ fontSize: '0.8rem', color: '#8f8f8f' }}>O administrador ainda não configurou sua ficha financeira.</div>
              </div>
            )}

            {!fichaFinLoading && fichaFin && (() => {
              const fin = fichaFin as any;
              const statusColor = (s: string) => s === 'pago' ? '#16a34a' : s === 'atrasado' ? '#dc2626' : '#f59e0b';
              const statusLabel = (s: string) => s === 'pago' ? 'Pago' : s === 'atrasado' ? 'Atrasado' : 'Pendente';
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                  {/* ── Batizado ── */}
                  {fin.batizado && fin.batizado.modalidade !== 'nao_definido' && (
                    <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#f5f5f4', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}><IconMedal size={15} /> Batizado / Troca de Graduação</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '3px 10px', fontWeight: 600 }}>Modalidade: {fin.batizado.modalidade === 'integral' ? 'À vista' : 'Parcelado'}</span>
                        <span style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '3px 10px', fontWeight: 600 }}>Total: R$ {Number(fin.batizado.valor_total || 0).toFixed(2)}</span>
                        <span style={{ fontSize: '0.78rem', background: statusColor(fin.batizado.status_geral) + '22', color: statusColor(fin.batizado.status_geral), borderRadius: 6, padding: '3px 10px', fontWeight: 700 }}>{statusLabel(fin.batizado.status_geral)}</span>
                      </div>
                      {fin.batizado.parcelas?.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {fin.batizado.parcelas.map((p: any, i: number) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', padding: '5px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }}>
                              <span>Parcela {p.numero} — R$ {Number(p.valor).toFixed(2)}</span>
                              <span style={{ color: statusColor(p.status), fontWeight: 700 }}>{statusLabel(p.status)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Mensalidades ── */}
                  {fin.mensalidades?.length > 0 && (
                    <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#f5f5f4', marginBottom: 10 }}><IconClock size={15} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Mensalidades</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(fin.mensalidades as any[]).slice().reverse().map((m: any, i: number) => {
                          const [yr, mo] = (m.mes || '').split('-');
                          const label = yr && mo ? new Date(Number(yr), Number(mo)-1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : m.mes;
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }}>
                              <span style={{ textTransform: 'capitalize' }}>{label} — R$ {Number(m.valor).toFixed(2)}</span>
                              <span style={{ color: statusColor(m.status), fontWeight: 700 }}>{statusLabel(m.status)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Contribuição mensal ── */}
                  {fin.contribuicao?.ativa && (
                    <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#f5f5f4', marginBottom: 8 }}><IconWallet size={15} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Contribuição Mensal</div>
                      <div style={{ fontSize: '0.82rem', color: '#d4d4d4' }}>Valor mensal: <strong>R$ {Number(fin.contribuicao.valor_mensal || 0).toFixed(2)}</strong></div>
                      {fin.contribuicao.historico?.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {(fin.contribuicao.historico as any[]).slice().reverse().slice(0, 6).map((h: any, i: number) => {
                            const [yr, mo] = (h.mes || '').split('-');
                            const label = yr && mo ? new Date(Number(yr), Number(mo)-1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : h.mes;
                            return (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', padding: '4px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }}>
                                <span style={{ textTransform: 'capitalize' }}>{label}</span>
                                <span style={{ color: statusColor(h.status), fontWeight: 700 }}>{statusLabel(h.status)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Uniformes ── */}
                  {fin.uniformes?.length > 0 && (
                    <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#f5f5f4', marginBottom: 8 }}><IconBag size={15} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Uniformes</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {(fin.uniformes as any[]).map((u: any, i: number) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', padding: '6px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }}>
                            <span>{u.descricao}{u.tamanho ? ` (${u.tamanho})` : ''} × {u.quantidade}</span>
                            <span style={{ color: u.status === 'entregue' ? '#16a34a' : u.status === 'cancelado' ? '#dc2626' : '#f59e0b', fontWeight: 700 }}>
                              {u.status === 'entregue' ? 'Entregue' : u.status === 'confirmado' ? '✓ Confirmado' : u.status === 'cancelado' ? '✕ Cancelado' : 'Solicitado'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* empty state */}
                  {!fin.batizado?.valor_total && !fin.mensalidades?.length && !fin.contribuicao?.ativa && !fin.uniformes?.length && (
                    <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '28px 20px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#6b6b6b' }}><IconNote size={26} /></span></div>
                      <div style={{ fontWeight: 700, color: '#d4d4d4', marginBottom: 4 }}>Nenhuma informação financeira registrada</div>
                      <div style={{ fontSize: '0.8rem', color: '#8f8f8f' }}>O administrador ainda não configurou sua ficha financeira.</div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── GRADUAÇÃO ── */}
        {activeTab === 'graduacao' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <SectionTitle icon={<IconMedal size={17} />}>Histórico de Graduação</SectionTitle>
              <button onClick={() => student && loadHistorico(student.id)} style={{ background: 'none', border: '1px solid rgba(255,146,0,0.45)', color: '#FF9200', borderRadius: 8, padding: '5px 12px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}><IconRefresh size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }} />Atualizar</button>
            </div>

            {/* Próximos eventos */}
            {(eventosLoading || eventos.length > 0) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Próximos Eventos</div>
                {eventosLoading && <div style={{ textAlign: 'center', padding: '12px 0', color: '#8f8f8f', fontSize: '0.82rem' }}>Carregando...</div>}
                {!eventosLoading && eventos.map((ev: any) => (
                  <div key={ev.id} style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: ev.tipo === 'batizado' ? 'rgba(250,204,21,0.12)' : 'rgba(168,85,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', flexShrink: 0 }}>
                      <IconBerimbau size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#f5f5f4' }}>{ev.nome}</div>
                      {ev.data && (
                        <div style={{ fontSize: '0.78rem', color: '#FF9200', fontWeight: 600, marginTop: 2 }}>
                          <IconClock size={12} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 5 }} />{new Date(ev.data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                          {ev.hora ? ` · ${ev.hora}` : ''}
                        </div>
                      )}
                      {ev.local && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#a3a3a3', marginTop: 1 }}><IconMapPin size={11} /> {ev.local}</div>}
                      {ev.nucleo && <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginTop: 1 }}>Núcleo: {ev.nucleo}</div>}
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'center' }}>
                      <div style={{ background: ev.tipo === 'batizado' ? 'rgba(250,204,21,0.12)' : 'rgba(168,85,247,0.12)', color: ev.tipo === 'batizado' ? '#92400e' : '#5b21b6', borderRadius: 8, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 700 }}>
                        {ev.tipo === 'batizado' ? 'Batizado' : 'Troca de Corda'}
                      </div>
                      {ev.participantes && ev.participantes.length > 0 && (
                        <div style={{ fontSize: '0.68rem', color: '#8f8f8f', marginTop: 3 }}>{ev.participantes.length} participante(s)</div>
                      )}
                    </div>
                  </div>
                ))}
                {!eventosLoading && eventos.length === 0 && (
                  <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center', fontSize: '0.82rem', color: '#8f8f8f' }}>
                    Nenhum evento programado no momento.
                  </div>
                )}
              </div>
            )}

            {/* Current graduation badge */}
            {student?.graduacao && (() => {
              const c = getGradColor(student.graduacao);
              return (
                <div style={{ background: c.bg, border: `2px solid ${c.border}`, borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: c.border, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}><IconMedal size={26} /></div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: c.text, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Graduação Atual</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: c.text }}>{student.graduacao}</div>
                    {student.tipo_graduacao && <div style={{ fontSize: '0.8rem', color: c.text, opacity: 0.7, marginTop: 1 }}>Tipo: {student.tipo_graduacao}</div>}
                  </div>
                </div>
              );
            })()}

            {/* Timeline */}
            {loadingHistorico ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#8f8f8f' }}>Carregando histórico...</div>
            ) : historico.length === 0 ? (
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '32px 20px', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}><span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#6b6b6b' }}><IconNote size={26} /></span></div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#d4d4d4', marginBottom: 4 }}>Nenhum registro encontrado</div>
                <div style={{ fontSize: '0.8rem', color: '#8f8f8f', lineHeight: 1.5 }}>
                  Seu histórico de graduações aparecerá aqui após o administrador finalizar os lançamentos de batizados e trocas de corda.
                </div>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                {/* Timeline line */}
                <div style={{ position: 'absolute', left: 20, top: 0, bottom: 0, width: 2, background: 'linear-gradient(to bottom, rgba(255,146,0,0.5), transparent)', borderRadius: 2 }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {historico.map((reg, idx) => {
                    const c = getGradColor(reg.graduacao_recebida);
                    return (
                      <div key={reg.id} style={{ display: 'flex', gap: 16, paddingBottom: 20, paddingLeft: 4 }}>
                        {/* Timeline dot */}
                        <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', background: c.bg, border: `2.5px solid ${c.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', zIndex: 1, marginTop: 4 }}>
                          {idx === 0 ? <IconStar size={18} /> : <IconMedal size={18} />}
                        </div>

                        {/* Card */}
                        <div style={{ flex: 1, background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text, borderRadius: 8, padding: '2px 10px', fontSize: '0.82rem', fontWeight: 700 }}>
                                  {reg.graduacao_recebida}
                                </span>
                                {idx === 0 && (
                                  <span style={{ background: 'rgba(34,197,94,0.10)', color: '#86efac', borderRadius: 8, padding: '2px 8px', fontSize: '0.72rem', fontWeight: 700 }}>
                                    Mais recente
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f5f5f4', marginTop: 6 }}>{reg.evento}</div>
                              <div style={{ fontSize: '0.76rem', color: '#a3a3a3', marginTop: 2 }}>Prof. {reg.professor_responsavel}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#FF9200' }}>
                                {new Date(reg.data_graduacao + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </div>
                            </div>
                          </div>
                          {reg.observacoes && (
                            <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.05)', borderRadius: 8, fontSize: '0.78rem', color: '#a3a3a3', fontStyle: 'italic' }}>
                              &ldquo;{reg.observacoes}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ background: 'rgba(14,165,233,0.10)', borderRadius: 12, padding: '12px 16px', border: '1px solid rgba(14,165,233,0.35)', fontSize: '0.78rem', color: '#7dd3fc', lineHeight: 1.5 }}>
              <IconInfo size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }} />O histórico é atualizado automaticamente quando o administrador finaliza um evento de batizado ou troca de corda no painel.
            </div>
          </div>
        )}

        {/* ── JUSTIFICATIVAS ── */}
        {activeTab === 'justificativas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <SectionTitle icon={<IconNote size={17} />}>Justificativas de Falta</SectionTitle>

            {/* Form */}
            <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f5f5f4', marginBottom: 14 }}>Enviar nova justificativa</div>
              {justMsg && (
                <div style={{ background: justMsgType === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${justMsgType === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, color: justMsgType === 'success' ? '#86efac' : '#fca5a5', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: '0.83rem' }}>
                  {justMsgType === 'success' ? '' : ''}{justMsg}
                </div>
              )}
              <form onSubmit={handleSubmitJustificativa} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#d4d4d4', marginBottom: 5 }}>Data da Falta *</label>
                  <input type="date" value={justForm.data_falta} onChange={e => setJustForm(p => ({ ...p, data_falta: e.target.value }))}
                    max={new Date().toISOString().split('T')[0]}
                    min={new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                    style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} required />
                  <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginTop: 3 }}>Apenas os últimos 30 dias</div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#d4d4d4', marginBottom: 5 }}>Motivo da Falta *</label>
                  <textarea value={justForm.motivo} onChange={e => setJustForm(p => ({ ...p, motivo: e.target.value }))}
                    style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box', resize: 'none' }}
                    rows={3} placeholder="Descreva o motivo da falta..." maxLength={500} required />
                  <div style={{ fontSize: '0.72rem', color: '#8f8f8f', textAlign: 'right', marginTop: 2 }}>{justForm.motivo.length}/500</div>
                </div>
                <button type="submit" disabled={justLoading}
                  style={{ background: justLoading ? '#3a3a3a' : 'linear-gradient(135deg, #FF9200, #d97706)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: '0.9rem', cursor: justLoading ? 'not-allowed' : 'pointer' }}>
                  {justLoading ? 'Enviando...' : 'Enviar Justificativa'}
                </button>
              </form>
            </div>

            {/* List */}
            <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f5f5f4', marginBottom: 14 }}>Minhas justificativas</div>
              {justificativas.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#8f8f8f', fontSize: '0.85rem' }}>Nenhuma justificativa enviada ainda.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {justificativas.map(j => (
                    <div key={j.id} style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f5f5f4' }}>
                          {new Date(j.data_falta + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#a3a3a3', marginTop: 3 }}>{j.motivo}</div>
                        {j.resposta_mestre && (
                          <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(59,130,246,0.10)', borderRadius: 6, fontSize: '0.76rem', color: '#93c5fd' }}>
                            <IconNote size={12} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 5 }} />Mestre: {j.resposta_mestre}
                          </div>
                        )}
                      </div>
                      <span style={{
                        flexShrink: 0, padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
                        background: j.status === 'aprovado' ? '#dcfce7' : j.status === 'recusado' ? '#fee2e2' : '#fef9c3',
                        color: j.status === 'aprovado' ? '#4ade80' : j.status === 'recusado' ? '#f87171' : '#fbbf24',
                      }}>
                        {j.status === 'aprovado' ? 'Aprovada' : j.status === 'recusado' ? 'Recusada' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {/* ── FOTOS E VÍDEOS ── */}
        {activeTab === 'fotos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <SectionTitle icon={<IconCamera size={17} />}>Registro de Fotos e Vídeos</SectionTitle>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#a3a3a3' }}>Gerencie suas fotos e vídeos de treinos</p>
              </div>
              <button onClick={() => fotosFileRef.current?.click()} disabled={fotosUploading}
                style={{ background: `linear-gradient(135deg, #86198f, #9d174d)`, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', opacity: fotosUploading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                {fotosUploading ? 'Enviando...' : 'Enviar Arquivo'}
              </button>
              <input ref={fotosFileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={async e => {
                const file = e.target.files?.[0]; if (!file || !session) return;
                setFotosUploading(true); setFotosMsg('');
                try {
                  const fd = new FormData();
                  fd.append('file', file);
                  fd.append('student_id', alvoPerfil);
                  const res = await fetch('/api/aluno/media', { method: 'POST', body: fd });
                  const json = await res.json();
                  if (res.ok) { setFotosMsg('✓ Arquivo enviado com sucesso!'); await loadFotos(alvoPerfil); }
                  else { setFotosMsg('Erro: ' + (json.error || 'falha no upload')); }
                } catch (err: unknown) { setFotosMsg('Erro de conexão.'); }
                setFotosUploading(false);
                e.target.value = '';
              }} />
            </div>

            {fotosMsg && (
              <div style={{ padding: '10px 14px', background: fotosMsg.startsWith('✓') ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${fotosMsg.startsWith('✓') ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, borderRadius: 10, fontSize: '0.83rem', color: fotosMsg.startsWith('✓') ? '#86efac' : '#fca5a5', fontWeight: 600 }}>
                {fotosMsg}
              </div>
            )}

            {fotosLoading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#8f8f8f', fontSize: '0.9rem' }}>Carregando arquivos...</div>
            ) : fotosMedia.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(236,72,153,0.10)', borderRadius: 16, border: '2px dashed #f0abfc' }}>
                <div style={{ color: '#f9a8d4', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><IconCamera size={46} strokeWidth={1.4} /></div>
                <div style={{ fontWeight: 700, color: '#86198f', fontSize: '0.95rem' }}>Nenhum arquivo ainda</div>
                <div style={{ fontSize: '0.78rem', color: '#8f8f8f', marginTop: 6 }}>Clique em "Enviar Arquivo" para adicionar fotos ou vídeos de treino</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
                {fotosMedia.map(m => (
                  <div key={m.name} style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                    {m.type === 'foto' ? (
                      <a href={m.url} target="_blank" rel="noreferrer">
                        <img src={m.url} alt={m.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                      </a>
                    ) : (
                      <a href={m.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', aspectRatio: '1', background: 'rgba(255,255,255,0.05)', textDecoration: 'none' }}>
                        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#6b6b6b' }}><IconCamera size={26} /></span>
                      </a>
                    )}
                    <div style={{ padding: '8px 10px' }}>
                      <div style={{ fontSize: '0.7rem', color: '#a3a3a3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name.replace(/^[^_]+_/, '')}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                        <a href={m.url} download target="_blank" rel="noreferrer"
                          style={{ flex: 1, background: 'rgba(59,130,246,0.10)', color: '#93c5fd', borderRadius: 6, padding: '4px 6px', fontSize: '0.68rem', fontWeight: 700, textDecoration: 'none', textAlign: 'center' }}>
                          ⬇ Baixar
                        </a>
                        <button onClick={async () => {
                          if (!confirm('Excluir este arquivo?')) return;
                          const res = await fetch('/api/aluno/media', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id: session!.student_id, name: m.name }) });
                          if (res.ok) { setFotosMedia(prev => prev.filter(f => f.name !== m.name)); setFotosMsg('Arquivo excluído.'); }
                        }} style={{ background: 'rgba(239,68,68,0.09)', color: '#f87171', border: 'none', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', fontWeight: 700 }}>
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: '0.72rem', color: '#8f8f8f', textAlign: 'center' }}>
              Formatos aceitos: JPG, PNG, GIF, MP4, MOV • Máx. 50 MB por arquivo
            </div>
          </div>
        )}

        {/* ── DOCUMENTOS PESSOAIS ── */}
        {activeTab === 'docs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <SectionTitle icon={<IconFolder size={17} />}>Meus Documentos</SectionTitle>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#a3a3a3' }}>PDF, Word, imagens, planilhas e qualquer formato — máx. 50 MB</p>
              </div>
              <button
                onClick={() => docsFileRef.current?.click()}
                disabled={docsUploading}
                style={{ background: docsUploading ? '#3a3a3a' : 'linear-gradient(135deg, #FF9200, #d97706)', color: docsUploading ? '#8f8f8f' : '#fff', border: 'none', borderRadius: 10, padding: '9px 18px', cursor: docsUploading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {docsUploading ? 'Enviando...' : 'Enviar Documento'}
              </button>
              <input ref={docsFileRef} type="file" accept="*/*" style={{ display: 'none' }} onChange={async e => {
                const file = e.target.files?.[0];
                if (!file || !session) return;
                setDocsUploading(true); setDocsMsg('');
                try {
                  const fd = new FormData();
                  fd.append('student_id', alvoPerfil);
                  fd.append('file', file);
                  const res = await fetch('/api/aluno/docs', { method: 'POST', body: fd });
                  const data = await res.json();
                  if (!res.ok) { setDocsMsg(data.error || 'Erro ao enviar.'); }
                  else {
                    setDocsMsg('✓ Documento enviado com sucesso!');
                    loadDocs(alvoPerfil);
                    setTimeout(() => setDocsMsg(''), 3000);
                  }
                } catch { setDocsMsg('Erro de conexão.'); }
                finally { setDocsUploading(false); e.target.value = ''; }
              }} />
            </div>

            {docsMsg && (
              <div style={{ padding: '10px 14px', background: docsMsg.startsWith('✓') ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${docsMsg.startsWith('✓') ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, borderRadius: 10, fontSize: '0.83rem', color: docsMsg.startsWith('✓') ? '#86efac' : '#fca5a5', fontWeight: 600 }}>
                {docsMsg}
              </div>
            )}

            {docsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#8f8f8f', fontSize: '0.9rem' }}>Carregando documentos...</div>
            ) : docsItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', background: 'rgba(14,165,233,0.10)', borderRadius: 16, border: '2px dashed #bae6fd' }}>
                <div style={{ color: '#93c5fd', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><IconFolder size={46} strokeWidth={1.4} /></div>
                <div style={{ fontWeight: 700, color: '#7dd3fc', fontSize: '0.95rem' }}>Nenhum documento ainda</div>
                <div style={{ fontSize: '0.78rem', color: '#8f8f8f', marginTop: 6, lineHeight: 1.5 }}>Clique em <strong>Enviar Documento</strong> para adicionar PDFs, imagens,<br/>contratos ou qualquer arquivo</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {docsItems.map(doc => (
                  <div key={doc.name} style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ fontSize: '2rem', flexShrink: 0 }}>{doc.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f5f5f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.displayName}</div>
                      <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginTop: 2 }}>
                        {doc.size} • {doc.ext.toUpperCase()} • {doc.created_at ? new Date(doc.created_at).toLocaleDateString('pt-BR') : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <a href={doc.url} target="_blank" rel="noopener noreferrer" download
                        style={{ background: 'linear-gradient(135deg, #0369a1, #0284c7)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                        ⬇ Baixar
                      </a>
                      <button onClick={async () => {
                        if (!session) return;
                        const res = await fetch('/api/aluno/docs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ student_id: alvoPerfil, name: doc.name }) });
                        if (res.ok) { setDocsItems(prev => prev.filter(d => d.name !== doc.name)); setDocsMsg('✓ Documento removido.'); setTimeout(() => setDocsMsg(''), 3000); }
                        else setDocsMsg('Erro ao remover documento.');
                      }}
                        style={{ background: 'rgba(239,68,68,0.09)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, padding: '8px 10px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CONTA / PERFIL ── */}
        {activeTab === 'conta' && session && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {contaSection === 'main' && (
              <>
                <div>
                  <SectionTitle icon={<IconGear size={17} />}>Minha Conta</SectionTitle>
                  <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#a3a3a3' }}>Gerencie suas credenciais de acesso</p>
                </div>

                {/* Responsáveis, tutelados e autorização de adolescente */}
                <div>
                  <SectionTitle icon={<IconUser size={17} />}>Responsáveis & Perfis</SectionTitle>
                  <PerfilGuardiaoCard />
                </div>

                {/* Current account info */}
                <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Dados da Conta</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginBottom: 1 }}>Usuário</div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f5f5f4' }}>{session.username}</div>
                    </div>
                    <span style={{ background: 'rgba(34,197,94,0.10)', color: '#4ade80', borderRadius: 20, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700 }}>Ativo</span>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginBottom: 1 }}>E-mail de recuperação</div>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: student?.email ? '#f5f5f4' : '#8f8f8f', fontStyle: student?.email ? 'normal' : 'italic' }}>
                      {student?.email || 'Não cadastrado'}
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button onClick={() => { setContaSection('edit-profile'); setContaForm(f => ({ ...f, new_username: session.username, new_email: student?.email || '' })); setContaMsg(''); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(59,130,246,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#93c5fd', flexShrink: 0 }}><IconPencil size={17} /></div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#93c5fd' }}>Editar Perfil</div>
                      <div style={{ fontSize: '0.73rem', color: '#a3a3a3', marginTop: 1 }}>Alterar usuário e e-mail de recuperação</div>
                    </div>
                    <span style={{ color: '#93c5fd', fontSize: '1.1rem' }}>›</span>
                  </button>

                  <button onClick={() => { setContaSection('change-password'); setContaForm(f => ({ ...f, current_password: '', new_password: '', confirm_password: '' })); setContaMsg(''); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, rgba(255,146,0,0.30), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#FF9200' }}><IconLock size={17} /></div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#7e22ce' }}>Alterar Senha</div>
                      <div style={{ fontSize: '0.73rem', color: '#a3a3a3', marginTop: 1 }}>Trocar sua senha de acesso</div>
                    </div>
                    <span style={{ color: '#c4b5fd', fontSize: '1.1rem' }}>›</span>
                  </button>

                  <button onClick={() => { setContaSection('delete-account'); setContaForm(f => ({ ...f, current_password: '' })); setDeleteConfirmText(''); setContaMsg(''); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(239,68,68,0.09)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#f87171' }}><IconTrash size={17} /></div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f87171' }}>Excluir Conta de Acesso</div>
                      <div style={{ fontSize: '0.73rem', color: '#a3a3a3', marginTop: 1 }}>Remove apenas o login — seu histórico é mantido</div>
                    </div>
                    <span style={{ color: '#fca5a5', fontSize: '1.1rem' }}>›</span>
                  </button>
                </div>
              </>
            )}

            {/* ── EDIT PROFILE ── */}
            {contaSection === 'edit-profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setContaSection('main')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#a3a3a3', padding: '4px 6px', borderRadius: 8 }}>←</button>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f5f5f4' }}>Editar Perfil</h2>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#a3a3a3' }}>Confirme sua senha para alterar</p>
                  </div>
                </div>
                <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '18px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Novo Usuário</label>
                      <input type="text" value={contaForm.new_username} onChange={e => setContaForm(f => ({ ...f, new_username: e.target.value }))}
                        style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>E-mail de Recuperação</label>
                      <input type="email" value={contaForm.new_email} onChange={e => setContaForm(f => ({ ...f, new_email: e.target.value }))}
                        placeholder="seu@email.com"
                        style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Senha Atual <span style={{ color: '#f87171' }}>*</span></label>
                      <input type="password" value={contaForm.current_password} onChange={e => setContaForm(f => ({ ...f, current_password: e.target.value }))}
                        placeholder="Confirme sua senha atual"
                        style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    {contaMsg && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: contaMsgType === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${contaMsgType === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, color: contaMsgType === 'success' ? '#86efac' : '#fca5a5', fontSize: '0.83rem', fontWeight: 600 }}>
                        {contaMsg}
                      </div>
                    )}
                    <button disabled={contaLoading} onClick={async () => {
                      if (!contaForm.current_password) { setContaMsg('Informe sua senha atual.'); setContaMsgType('error'); return; }
                      setContaLoading(true); setContaMsg('');
                      try {
                        const res = await fetch('/api/aluno/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'update-profile', student_id: session.student_id, new_username: contaForm.new_username.trim(), new_email: contaForm.new_email.trim(), current_password: contaForm.current_password }) });
                        const data = await res.json();
                        if (res.ok) {
                          setContaMsg('✓ Perfil atualizado com sucesso!'); setContaMsgType('success');
                          const newSess = { ...session, username: data.username };
                          sessionStorage.setItem('aluno_session', JSON.stringify(newSess));
                          setSession(newSess);
                          // Update email in student state directly from API response
                          if (student) setStudent(prev => prev ? { ...prev, email: data.email !== undefined ? data.email : prev.email } : prev);
                          // Reload full student data to ensure all fields are fresh
                          loadStudentData(alvoPerfil || session.student_id);
                          setTimeout(() => setContaSection('main'), 1500);
                        } else { setContaMsg(data.error || 'Erro ao atualizar.'); setContaMsgType('error'); }
                      } catch { setContaMsg('Erro de conexão.'); setContaMsgType('error'); }
                      setContaLoading(false);
                    }} style={{ background: 'linear-gradient(135deg,#1d4ed8,#1e40af)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: '0.9rem', cursor: contaLoading ? 'wait' : 'pointer', opacity: contaLoading ? 0.7 : 1 }}>
                      {contaLoading ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── CHANGE PASSWORD ── */}
            {contaSection === 'change-password' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setContaSection('main')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#a3a3a3', padding: '4px 6px', borderRadius: 8 }}>←</button>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f5f5f4' }}>Alterar Senha</h2>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#a3a3a3' }}>Escolha uma senha forte</p>
                  </div>
                </div>
                <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '18px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {(['current_password', 'new_password', 'confirm_password'] as const).map((field, i) => (
                      <div key={field}>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {['Senha Atual', 'Nova Senha', 'Confirmar Nova Senha'][i]} <span style={{ color: '#f87171' }}>*</span>
                        </label>
                        <input type="password" value={contaForm[field]} onChange={e => setContaForm(f => ({ ...f, [field]: e.target.value }))}
                          style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                    ))}
                    {contaMsg && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: contaMsgType === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${contaMsgType === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, color: contaMsgType === 'success' ? '#86efac' : '#fca5a5', fontSize: '0.83rem', fontWeight: 600 }}>
                        {contaMsg}
                      </div>
                    )}
                    <button disabled={contaLoading} onClick={async () => {
                      if (contaForm.new_password !== contaForm.confirm_password) { setContaMsg('As senhas não coincidem.'); setContaMsgType('error'); return; }
                      if (contaForm.new_password.length < 6) { setContaMsg('A nova senha deve ter pelo menos 6 caracteres.'); setContaMsgType('error'); return; }
                      setContaLoading(true); setContaMsg('');
                      try {
                        const res = await fetch('/api/aluno/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'change-password', student_id: session.student_id, current_password: contaForm.current_password, new_password: contaForm.new_password }) });
                        const data = await res.json();
                        if (res.ok) { setContaMsg('✓ Senha alterada com sucesso!'); setContaMsgType('success'); setContaForm(f => ({ ...f, current_password: '', new_password: '', confirm_password: '' })); setTimeout(() => setContaSection('main'), 1500); }
                        else { setContaMsg(data.error || 'Erro ao alterar senha.'); setContaMsgType('error'); }
                      } catch { setContaMsg('Erro de conexão.'); setContaMsgType('error'); }
                      setContaLoading(false);
                    }} style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: '#fff', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: '0.9rem', cursor: contaLoading ? 'wait' : 'pointer', opacity: contaLoading ? 0.7 : 1 }}>
                      {contaLoading ? 'Alterando...' : 'Alterar Senha'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── DELETE ACCOUNT ── */}
            {contaSection === 'delete-account' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setContaSection('main')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#a3a3a3', padding: '4px 6px', borderRadius: 8 }}>←</button>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f87171' }}>Excluir Conta</h2>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#a3a3a3' }}>Esta ação é irreversível</p>
                  </div>
                </div>
                <div style={{ background: 'rgba(239,68,68,0.09)', border: '1.5px solid rgba(239,68,68,0.4)', borderRadius: 14, padding: '16px 18px' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#fca5a5', marginBottom: 8 }}>O que acontece ao excluir:</div>
                  <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: '0.82rem', color: '#fca5a5', lineHeight: 1.7 }}>
                    <li>Seu login e senha são <strong>removidos permanentemente</strong></li>
                    <li>Seu histórico de presenças e graduações <strong>é mantido</strong></li>
                    <li>Você precisará de nova conta para acessar a plataforma</li>
                  </ul>
                </div>
                <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '18px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Digite <strong>EXCLUIR</strong> para confirmar</label>
                      <input type="text" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                        placeholder="EXCLUIR"
                        style={{ width: '100%', border: `1.5px solid ${deleteConfirmText === 'EXCLUIR' ? '#dc2626' : '#2e2e2e'}`, borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Senha Atual <span style={{ color: '#f87171' }}>*</span></label>
                      <input type="password" value={contaForm.current_password} onChange={e => setContaForm(f => ({ ...f, current_password: e.target.value }))}
                        placeholder="Confirme sua senha"
                        style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    {contaMsg && (
                      <div style={{ padding: '10px 14px', borderRadius: 10, background: contaMsgType === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${contaMsgType === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, color: contaMsgType === 'success' ? '#86efac' : '#fca5a5', fontSize: '0.83rem', fontWeight: 600 }}>
                        {contaMsg}
                      </div>
                    )}
                    <button disabled={contaLoading || deleteConfirmText !== 'EXCLUIR'} onClick={async () => {
                      if (deleteConfirmText !== 'EXCLUIR') return;
                      setContaLoading(true); setContaMsg('');
                      try {
                        const res = await fetch('/api/aluno/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'delete-account', student_id: session.student_id, current_password: contaForm.current_password }) });
                        const data = await res.json();
                        if (res.ok) {
                          setContaMsg('✓ Conta excluída. Você será desconectado.'); setContaMsgType('success');
                          setTimeout(() => { sessionStorage.removeItem('aluno_session'); setSession(null); setStudent(null); setActiveTab('dashboard'); }, 2000);
                        } else { setContaMsg(data.error || 'Erro ao excluir conta.'); setContaMsgType('error'); }
                      } catch { setContaMsg('Erro de conexão.'); setContaMsgType('error'); }
                      setContaLoading(false);
                    }} style={{ background: deleteConfirmText === 'EXCLUIR' ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : '#2e2e2e', color: deleteConfirmText === 'EXCLUIR' ? '#fff' : '#9ca3af', border: 'none', borderRadius: 10, padding: '12px', fontWeight: 700, fontSize: '0.9rem', cursor: (contaLoading || deleteConfirmText !== 'EXCLUIR') ? 'not-allowed' : 'pointer', opacity: contaLoading ? 0.7 : 1 }}>
                      {contaLoading ? 'Excluindo...' : 'Excluir Minha Conta Definitivamente'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PLAYLIST DO ALUNO ── */}
        {activeTab === 'playlist' && session && (() => {
          function getPlatformEmbed(item: { url: string; platform: string }) {
            try {
              const u = new URL(item.url);
              if (item.platform === 'youtube' || u.hostname.includes('youtu')) {
                const m = u.pathname.match(/\/shorts\/([\w-]+)/) || u.pathname.match(/\/([\w-]{11})$/) || (u.search.match(/[?&]v=([\w-]+)/));
                const vid = m ? m[1] : null;
                if (vid) return { type: 'iframe', src: `https://www.youtube.com/embed/${vid}?rel=0` };
              }
              if (item.platform === 'spotify' || u.hostname.includes('spotify')) {
                return { type: 'iframe', src: `https://open.spotify.com/embed${u.pathname}?utm_source=generator&theme=0` };
              }
              if (item.platform === 'deezer' || u.hostname.includes('deezer')) {
                const m = u.pathname.match(/(track|album|playlist)\/(\d+)/);
                if (m) return { type: 'iframe', src: `https://widget.deezer.com/widget/dark/${m[1]}/${m[2]}` };
              }
            } catch {}
            return null;
          }
          const platformMeta: Record<string, { icon: React.ReactNode; label: string }> = {
            youtube: { icon: <IconCamera size={12} />, label: 'YouTube' },
            spotify: { icon: <IconMusic size={12} />, label: 'Spotify' },
            deezer:  { icon: <IconMusic size={12} />, label: 'Deezer' },
            tiktok:  { icon: <IconMusic size={12} />, label: 'TikTok' },
            kwai:    { icon: <IconMusic size={12} />, label: 'Kwai' },
            link:    { icon: <IconLink size={12} />, label: 'Link' },
          };

          const handleAddPlaylist = async () => {
            if (!playlistAddUrl.trim()) return;
            setPlaylistAdding(true); setPlaylistMsg('');
            try {
              const res = await fetch('/api/aluno/playlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: alvoPerfil, url: playlistAddUrl.trim(), title: playlistAddTitle.trim() || undefined }),
              });
              const data = await res.json();
              if (res.ok) {
                setPlaylistItems(prev => [data.item, ...prev]);
                setPlaylistAddUrl('');
                setPlaylistAddTitle('');
                setPlaylistMsg('Link adicionado!');
                setPlaylistMsgType('success');
              } else {
                setPlaylistMsg(data.error || 'Erro ao adicionar.');
                setPlaylistMsgType('error');
              }
            } catch { setPlaylistMsg('Erro de conexão.'); setPlaylistMsgType('error'); }
            setPlaylistAdding(false);
          };

          const handleDeletePlaylist = async (id: string) => {
            if (!confirm('Remover este item da playlist?')) return;
            try {
              const res = await fetch('/api/aluno/playlist', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: alvoPerfil, id }),
              });
              if (res.ok) setPlaylistItems(prev => prev.filter(i => i.id !== id));
            } catch {}
          };

          const handleEditPlaylist = async (id: string) => {
            try {
              const res = await fetch('/api/aluno/playlist', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: alvoPerfil, id, title: playlistEditTitle.trim() || undefined, url: playlistEditUrl.trim() || undefined }),
              });
              const data = await res.json();
              if (res.ok) {
                setPlaylistItems(prev => prev.map(i => i.id === id ? data.item : i));
                setPlaylistEditId(null);
              }
            } catch {}
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <SectionTitle icon={<IconMusic size={17} />}>Minha Playlist</SectionTitle>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#a3a3a3' }}>Adicione links do Spotify, Deezer, YouTube, TikTok e Kwai</p>
              </div>

              {/* Formulário para adicionar */}
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f5f5f4', marginBottom: 12 }}>Adicionar link</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    type="url"
                    value={playlistAddUrl}
                    onChange={e => setPlaylistAddUrl(e.target.value)}
                    placeholder="Cole aqui o link (Spotify, YouTube, TikTok, Deezer, Kwai...)"
                    style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }}
                    onKeyDown={e => e.key === 'Enter' && handleAddPlaylist()}
                  />
                  <input
                    type="text"
                    value={playlistAddTitle}
                    onChange={e => setPlaylistAddTitle(e.target.value)}
                    placeholder="Título (opcional — será preenchido automaticamente)"
                    style={{ width: '100%', border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '10px 14px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                  {playlistMsg && (
                    <div style={{ padding: '8px 12px', borderRadius: 8, background: playlistMsgType === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${playlistMsgType === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, color: playlistMsgType === 'success' ? '#86efac' : '#fca5a5', fontSize: '0.82rem', fontWeight: 600 }}>
                      {playlistMsg}
                    </div>
                  )}
                  <button onClick={handleAddPlaylist} disabled={playlistAdding || !playlistAddUrl.trim()}
                    style={{ background: playlistAdding || !playlistAddUrl.trim() ? '#3a3a3a' : 'linear-gradient(135deg,#FF9200,#d97706)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px', fontWeight: 700, fontSize: '0.88rem', cursor: playlistAdding || !playlistAddUrl.trim() ? 'not-allowed' : 'pointer' }}>
                    {playlistAdding ? 'Adicionando...' : 'Adicionar à Playlist'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                  {Object.entries(platformMeta).map(([key, meta]) => (
                    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,146,0,0.10)', border: '1px solid rgba(255,146,0,0.25)', color: '#fdba74', borderRadius: 20, padding: '3px 10px', fontSize: '0.7rem', fontWeight: 700 }}>
                      {meta.icon} {meta.label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Lista de itens */}
              {playlistLoading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#8f8f8f', fontSize: '0.9rem' }}>Carregando playlist...</div>
              ) : playlistItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', background: 'rgba(139,92,246,0.10)', borderRadius: 16, border: '2px dashed #a78bfa' }}>
                  <div style={{ color: '#c4b5fd', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><IconMusic size={46} strokeWidth={1.4} /></div>
                  <div style={{ fontWeight: 700, color: '#c4b5fd', fontSize: '0.95rem' }}>Playlist vazia</div>
                  <div style={{ fontSize: '0.78rem', color: '#8f8f8f', marginTop: 6 }}>Adicione links acima para criar sua playlist personalizada.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {playlistItems.map(item => {
                    const embed = getPlatformEmbed(item);
                    const meta = platformMeta[item.platform] || platformMeta.link;
                    const embedH = item.platform === 'spotify' ? 80 : item.platform === 'deezer' ? 100 : 157;
                    const isEditing = playlistEditId === item.id;
                    return (
                      <div key={item.id} style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
                        {isEditing ? (
                          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input type="text" value={playlistEditTitle} onChange={e => setPlaylistEditTitle(e.target.value)}
                              placeholder="Título" style={{ border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 8, padding: '8px 12px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%' }} />
                            <input type="url" value={playlistEditUrl} onChange={e => setPlaylistEditUrl(e.target.value)}
                              placeholder="URL" style={{ border: '1.5px solid rgba(255,255,255,0.09)', borderRadius: 8, padding: '8px 12px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%' }} />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button onClick={() => handleEditPlaylist(item.id)} style={{ flex: 1, background: '#FF9200', color: '#fff', border: 'none', borderRadius: 8, padding: '8px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>Salvar</button>
                              <button onClick={() => setPlaylistEditId(null)} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#d4d4d4', border: 'none', borderRadius: 8, padding: '8px', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}>Cancelar</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: embed ? '1px solid #1c1c1c' : 'none' }}>
                              <span style={{ background: 'rgba(255,146,0,0.14)', border: '1px solid rgba(255,146,0,0.35)', color: '#FF9200', borderRadius: 8, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{meta.icon}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f5f5f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                                <div style={{ fontSize: '0.7rem', color: '#fdba74', fontWeight: 600, marginTop: 1 }}>{meta.label}</div>
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                <a href={item.url} target="_blank" rel="noopener noreferrer"
                                  style={{ padding: '5px 10px', borderRadius: 7, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#d4d4d4', fontSize: '0.7rem', fontWeight: 700, textDecoration: 'none' }}>
                                  Abrir
                                </a>
                                <button onClick={() => { setPlaylistEditId(item.id); setPlaylistEditTitle(item.title); setPlaylistEditUrl(item.url); }}
                                  style={{ padding: '5px 8px', borderRadius: 7, background: 'rgba(255,146,0,0.10)', border: 'none', color: '#fdba74', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}><IconPencil size={12} /></button>
                                <button onClick={() => handleDeletePlaylist(item.id)}
                                  style={{ padding: '5px 8px', borderRadius: 7, background: 'rgba(239,68,68,0.09)', border: 'none', color: '#f87171', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}><IconTrash size={14} /></button>
                              </div>
                            </div>
                            {embed && embed.type === 'iframe' && (
                              <iframe src={embed.src} height={embedH} width="100%" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" style={{ display: 'block', border: 'none' }} />
                            )}
                            {!embed && (
                              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', textDecoration: 'none', color: '#fdba74', fontSize: '0.83rem', fontWeight: 600 }}>
                                <IconLink size={13} style={{ display: 'inline-block', verticalAlign: '-2px' }} /> Abrir no {meta.label}
                              </a>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: '0.72rem', color: '#8f8f8f', textAlign: 'center' }}>
                Plataformas suportadas: Spotify · Deezer · YouTube · TikTok · Kwai · outros links
              </div>
            </div>
          );
        })()}

        {/* ── MEUS DADOS ── */}
        {activeTab === 'dados' && session && student && (() => {
          // ── CPF validator ──────────────────────────────────────────────────
          const validarCPF = (cpf: string): boolean => {
            const d = cpf.replace(/\D/g, '');
            if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
            let s = 0;
            for (let i = 0; i < 9; i++) s += parseInt(d[i]) * (10 - i);
            let r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
            if (r !== parseInt(d[9])) return false;
            s = 0;
            for (let i = 0; i < 10; i++) s += parseInt(d[i]) * (11 - i);
            r = (s * 10) % 11; if (r === 10 || r === 11) r = 0;
            return r === parseInt(d[10]);
          };

          // ── graduation lists (canonical — from graduacoes.ts) ─────────────
          const INFANTIL_KEYS = [
            'Crua (Infantil)',
            'Crua ponta Cinza','Crua ponta Amarela','Crua ponta Laranja','Crua ponta Verde',
            'Crua ponta Azul','Crua ponta Roxa','Crua e Cinza','Crua e Laranja','Crua e Verde',
            'Crua e Azul','Crua e Roxa','Cinza','Cinza e Amarela','Verde e Amarela','Amarela e Azul',
          ];
          const GRADS_INFANTIL = GRADUACOES_ALL.filter(g => INFANTIL_KEYS.includes(g));
          const GRADS_ADULTO   = GRADUACOES_ALL.filter(g => !INFANTIL_KEYS.includes(g));

          // Auto-detect tipo from birth date (fonte única: src/lib/idade.ts)
          let autoTipo: 'Infantil' | 'Adulto' | '' = '';
          const dob = dadosForm.data_nascimento || (student.data_nascimento as string) || '';
          if (dob) {
            const idadeDob = idadeEm(dob);
            autoTipo = idadeDob >= 0 && idadeDob < 14 ? 'Infantil' : 'Adulto';
          }
          const tipoEfetivo = (dadosForm.tipo_graduacao || autoTipo) as 'Infantil' | 'Adulto' | '';
          const gradOpts = tipoEfetivo === 'Infantil' ? GRADS_INFANTIL : tipoEfetivo === 'Adulto' ? GRADS_ADULTO : [...GRADS_INFANTIL, ...GRADS_ADULTO];

          // ── masks ──────────────────────────────────────────────────────────
          const maskCPF = (v: string) => {
            const d = v.replace(/\D/g, '').slice(0, 11);
            if (d.length <= 3) return d;
            if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
            if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
            return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
          };
          const maskPhone = (v: string) => {
            const d = v.replace(/\D/g, '').slice(0, 11);
            if (d.length <= 2) return d.length ? `(${d}` : '';
            if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
            if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
            return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
          };
          const maskCEP = (v: string) => {
            const d = v.replace(/\D/g, '').slice(0, 8);
            return d.length > 5 ? `${d.slice(0,5)}-${d.slice(5)}` : d;
          };

          // ── CEP auto-fill (via server proxy to avoid CORS) ────────────────
          const handleCepBlur = async (cep: string) => {
            const digits = cep.replace(/\D/g, '');
            if (digits.length !== 8) return;
            try {
              const r = await fetch(`/api/cep?cep=${digits}`);
              if (!r.ok) return;
              const d = await r.json();
              if (d.error) return;
              setDadosForm(p => ({
                ...p,
                endereco: d.logradouro || p.endereco,
                bairro:   d.bairro     || p.bairro,
                cidade:   d.localidade || p.cidade,
                estado:   d.uf         || p.estado,
              }));
            } catch { /* silently ignore */ }
          };

          // ── save ───────────────────────────────────────────────────────────
          const handleSaveDados = async () => {
            setDadosLoading(true); setDadosMsg('');
            try {
              // Validação local dos documentos obrigatórios (o servidor valida de novo)
              const cpfLimpo = cpfDigits(dadosForm.cpf || '');
              if (cpfLimpo && !isValidCPF(cpfLimpo)) {
                setDadosMsg('CPF inválido — confira os 11 dígitos antes de salvar.'); setDadosMsgType('error'); setDadosLoading(false); return;
              }
              if (dadosForm.identidade && dadosForm.identidade.trim() && !isValidRG(dadosForm.identidade)) {
                setDadosMsg('RG inválido — confira o número.'); setDadosMsgType('error'); setDadosLoading(false); return;
              }
              if (!cpfLimpo) {
                setDadosMsg('CPF é obrigatório.'); setDadosMsgType('error'); setDadosLoading(false); return;
              }
              if (!dadosForm.identidade || !dadosForm.identidade.trim()) {
                setDadosMsg('RG é obrigatório.'); setDadosMsgType('error'); setDadosLoading(false); return;
              }
              const payload = {
                ...dadosForm,
                // data_nascimento em formato ISO (AAAA-MM-DD) — o input date já
                // entrega assim; enviado explicitamente para o servidor recalcular
                // a menoridade e preservar a data real (bug visual de "não salva").
                data_nascimento: (dadosForm.data_nascimento || '').trim(),
                tipo_graduacao: dadosForm.tipo_graduacao || autoTipo || dadosForm.tipo_graduacao,
              };
              const res = await fetch('/api/aluno/dados', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: alvoPerfil, ...payload }),
              });
              const data = await res.json();
              if (res.ok) {
                // Sincroniza o e-mail também na conta de acesso do aluno
                if (dadosForm.email && dadosForm.email.includes('@')) {
                  try {
                    await fetch('/api/aluno/contas', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ student_id: alvoPerfil, email: dadosForm.email.trim().toLowerCase() }),
                    });
                  } catch { /* sincronização de e-mail é melhor-esforço */ }
                }
                setDadosMsg('Dados salvos com sucesso!');
                setDadosMsgType('success');
                if (data.student) setStudent(data.student);
              } else {
                setDadosMsg(data.error || 'Erro ao salvar.');
                setDadosMsgType('error');
              }
            } catch { setDadosMsg('Erro de conexão.'); setDadosMsgType('error'); }
            setDadosLoading(false);
          };

          const handleFotoUpload = async (file: File) => {
            setFotoUploading(true); setFotoMsg('');
            try {
              const fd = new FormData();
              fd.append('student_id', alvoPerfil);
              fd.append('foto', file);
              const res = await fetch('/api/aluno/dados', { method: 'POST', body: fd });
              const data = await res.json();
              if (res.ok && data.foto_url) {
                setStudent(prev => prev ? { ...prev, foto_url: data.foto_url } : prev);
                setFotoMsg('Foto atualizada com sucesso!');
              } else {
                setFotoMsg(data.error || 'Erro ao enviar foto.');
              }
            } catch { setFotoMsg('Erro de conexão.'); }
            setFotoUploading(false);
          };

          // Abre o editor de foto antes de enviar
          const handleFotoPick = (file: File) => {
            setFotoEditando(file);
          };

          // Nucleos dinamicos carregados do banco
                const nucleo_opts = dynamicNucleos.map(n => n.nome);
          const sexo_opts = [{ v: 'M', l: 'Masculino' }, { v: 'F', l: 'Feminino' }, { v: 'O', l: 'Outro' }];
          const estados = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
          const isMissing = cadastroIncompleto;
          const fs: React.CSSProperties = { width: '100%', borderColor: 'rgba(255,255,255,0.12)', borderStyle: 'solid', borderWidth: 1.5, borderRadius: 8, padding: '9px 11px', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))' };
          const ls: React.CSSProperties = { display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d4', marginBottom: 4 };
          const sec: React.CSSProperties = { fontWeight: 800, fontSize: '0.78rem', color: '#a3a3a3', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid #1c1c1c' };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <SectionTitle icon={<IconPencil size={17} />}>Meus Dados</SectionTitle>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#a3a3a3' }}>Complete ou atualize suas informações de cadastro</p>
              </div>

              {/* ── Foto de Perfil ── */}
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flexShrink: 0, position: 'relative' }}>
                  {student.foto_url ? (
                    <img src={student.foto_url as string} alt={student.nome_completo} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(255,146,0,0.35)' }} />
                  ) : (
                    <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,146,0,0.10)', border: '3px solid rgba(255,146,0,0.30)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="42" height="42" viewBox="0 0 64 64" fill="none">
                        <circle cx="32" cy="14" r="9" fill={nucleoColor} opacity="0.7"/>
                        <path d="M32 23 C24 27 20 37 22 46 L18 62" stroke={nucleoColor} strokeWidth="4" strokeLinecap="round" opacity="0.7"/>
                        <path d="M32 23 C40 27 44 37 42 46 L46 62" stroke={nucleoColor} strokeWidth="4" strokeLinecap="round" opacity="0.7"/>
                        <path d="M22 46 L10 54" stroke={nucleoColor} strokeWidth="4" strokeLinecap="round" opacity="0.7"/>
                        <path d="M42 46 L54 40" stroke={nucleoColor} strokeWidth="4" strokeLinecap="round" opacity="0.7"/>
                      </svg>
                    </div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f5f5f4', marginBottom: 2 }}>Foto de Perfil</div>
                  <div style={{ fontSize: '0.72rem', color: '#a3a3a3', marginBottom: 8 }}>JPG, PNG — máx. 5 MB. Aparece na carteirinha e no painel.</div>
                  {fotoMsg && <div style={{ fontSize: '0.75rem', color: fotoMsg.startsWith('✓') ? '#16a34a' : '#dc2626', marginBottom: 6, fontWeight: 600 }}>{fotoMsg}</div>}
                  <input ref={fotoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFotoPick(f); e.target.value = ''; }} />
                  <button onClick={() => fotoInputRef.current?.click()} disabled={fotoUploading}
                    style={{ background: fotoUploading ? '#3a3a3a' : 'rgba(255,146,0,0.10)', color: fotoUploading ? '#8f8f8f' : '#FF9200', border: '1.5px solid rgba(255,146,0,0.4)', borderRadius: 8, padding: '7px 16px', fontWeight: 700, fontSize: '0.8rem', cursor: fotoUploading ? 'not-allowed' : 'pointer' }}>
                    {fotoUploading ? 'Enviando...' : student.foto_url ? 'Trocar Foto' : 'Adicionar Foto'}
                  </button>
                </div>
              </div>

              {/* Editor de foto (recorte/rotação/brilho) */}
              {fotoEditando && (
                <PhotoEditor
                  file={fotoEditando}
                  onCancel={() => setFotoEditando(null)}
                  onConfirm={edited => {
                    setFotoEditando(null);
                    handleFotoUpload(edited);
                  }}
                />
              )}

              {/* ── Matrícula ── */}
              {(student.ordem_inscricao || alunoInscricaoNum) && (
                <div style={{ background: 'rgba(255,146,0,0.06)', border: '1px solid rgba(255,146,0,0.30)', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,146,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF9200', flexShrink: 0 }}><IconIdCard size={16} /></div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#a3a3a3', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>Matrícula</div>
                    <div style={{ fontWeight: 800, fontSize: '1.1rem', color: nucleoColor, fontFamily: 'monospace' }}>
                      #{String(student.ordem_inscricao as number || alunoInscricaoNum || 0).padStart(4, '0')}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: '#8f8f8f' }}>Número de matrícula na associação</div>
                  </div>
                </div>
              )}

              {/* Aviso de completude obrigatório */}
              <div style={{ background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.35)', borderRadius: 12, padding: '12px 16px', fontSize: '0.82rem', color: '#93c5fd', fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ display: 'flex', color: '#FF9200', flexShrink: 0 }}><IconNote size={18} /></span>
                <div>
                  <div>Por favor, complete e atualize todos os dados do seu cadastro.</div>
                  <div style={{ fontWeight: 400, fontSize: '0.75rem', marginTop: 3, color: '#3b82f6' }}>
                    CPF, Identidade e Numeração Única são opcionais — crianças podem salvar sem preencher esses campos.
                  </div>
                </div>
              </div>

              {isMissing && (
                <div style={{ background: 'rgba(234,179,8,0.10)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 12, padding: '12px 16px', fontSize: '0.8rem', color: '#fcd34d' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconWarn size={13} /> Dados incompletos. Preencha os campos abaixo para finalizar seu cadastro.</span>
                </div>
              )}

              {dadosMsg && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: dadosMsgType === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${dadosMsgType === 'success' ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, color: dadosMsgType === 'success' ? '#86efac' : '#fca5a5', fontSize: '0.83rem', fontWeight: 600 }}>
                  {dadosMsg}
                </div>
              )}

              {/* ── Identificação na Associação — escondida na conta só-responsável ── */}
              {!respOnly && (
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                <div style={sec}>Identificação na Associação</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={ls}>Núcleo <span style={{ color: '#ef4444' }}>*</span></label>
                    <select value={dadosForm.nucleo} onChange={e => setDadosForm(p => ({ ...p, nucleo: e.target.value }))} style={fs}>
                      <option value="">— Selecione seu núcleo —</option>
                      {nucleo_opts.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>

                  {/* Tipo de graduação — determinado pela data de nascimento ou seleção manual */}
                  <div>
                    <label style={ls}>Tipo de Graduação</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {(['Infantil', 'Adulto'] as const).map(t => (
                        <button key={t} type="button" onClick={() => setDadosForm(p => ({ ...p, tipo_graduacao: t, graduacao: '' }))}
                          style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `2px solid ${tipoEfetivo === t ? 'rgba(255,146,0,0.6)' : '#2a2a2a'}`, background: tipoEfetivo === t ? 'rgba(255,146,0,0.10)' : '#161616', color: tipoEfetivo === t ? '#FF9200' : '#d4d4d4', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', transition: 'all 0.15s' }}>
                          {t === 'Infantil' ? 'Infantil' : 'Adulto'}
                        </button>
                      ))}
                    </div>
                    {autoTipo && !dadosForm.tipo_graduacao && (
                      <div style={{ fontSize: '0.72rem', color: '#a3a3a3', marginTop: 4 }}>
                        Detectado automaticamente como <strong>{autoTipo}</strong> com base na data de nascimento
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={ls}>Graduação <span style={{ color: '#ef4444' }}>*</span></label>
                    <select value={dadosForm.graduacao} onChange={e => setDadosForm(p => ({ ...p, graduacao: e.target.value }))} style={fs}>
                      <option value="">— Selecione sua graduação —</option>
                      {tipoEfetivo && <optgroup label={`Graduaç��o ${tipoEfetivo}`}>
                        {gradOpts.map(g => <option key={g} value={g}>{g}{nomenclaturaGraduacao[g] ? ` — ${nomenclaturaGraduacao[g]}` : ''}</option>)}
                      </optgroup>}
                      {!tipoEfetivo && <>
                        <optgroup label="Graduação Infantil">{GRADS_INFANTIL.map(g => <option key={g} value={g}>{g}{nomenclaturaGraduacao[g] ? ` — ${nomenclaturaGraduacao[g]}` : ''}</option>)}</optgroup>
                        <optgroup label="Graduação Adulta">{GRADS_ADULTO.map(g => <option key={g} value={g}>{g}{nomenclaturaGraduacao[g] ? ` — ${nomenclaturaGraduacao[g]}` : ''}</option>)}</optgroup>
                      </>}
                    </select>
                    {tipoEfetivo && (
                      <div style={{ fontSize: '0.72rem', color: '#a3a3a3', marginTop: 4 }}>
                        Exibindo graduações para: <strong>{tipoEfetivo}</strong>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )}

              {/* ── Dados Pessoais ── */}
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                <div style={sec}>Dados Pessoais</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={ls}>Apelido / Apelido na Capoeira</label>
                    <input value={dadosForm.apelido} onChange={e => setDadosForm(p => ({ ...p, apelido: e.target.value }))} style={fs} placeholder="Como te chamam" />
                  </div>
                  <div>
                    <label style={ls}>Nome Social</label>
                    <input value={dadosForm.nome_social} onChange={e => setDadosForm(p => ({ ...p, nome_social: e.target.value }))} style={fs} placeholder="Nome social (opcional)" />
                  </div>
                  <div>
                    <label style={ls}>Sexo</label>
                    <select value={dadosForm.sexo} onChange={e => setDadosForm(p => ({ ...p, sexo: e.target.value }))} style={fs}>
                      <option value="">— Selecione —</option>
                      {sexo_opts.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ ...ls, display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={dadosForm.autoriza_imagem}
                        onChange={e => setDadosForm(p => ({ ...p, autoriza_imagem: e.target.checked }))}
                        style={{ width: 18, height: 18, marginTop: 1, accentColor: nucleoColor, flexShrink: 0 }}
                      />
                      <span style={{ fontWeight: 600, fontSize: '0.82rem', color: '#d4d4d4', lineHeight: 1.4 }}>
                        Autorizo o uso da minha imagem (fotos/vídeos) para fins institucionais do Portal Aluno, incluindo redes sociais, materiais de divulgação e eventos.
                      </span>
                    </label>
                  </div>
                  <div>
                    <label style={ls}>Data de Nascimento</label>
                    <input type="date" value={dadosForm.data_nascimento} onChange={e => {
                      const dob = e.target.value;
                      setDadosForm(p => ({ ...p, data_nascimento: dob }));
                      // Auto-detect minor → show Termo alert (cálculo central idadeEm)
                      if (dob) {
                        const age = idadeEm(dob);
                        if (age >= 0 && age < 18) {
                          setDadosMsg('Aluno menor de idade detectado. O Termo de Responsabilidade é obrigatório — acesse a aba Termo.');
                          setDadosMsgType('error');
                        }
                      }
                    }} style={fs} />
                    {(() => {
                      if (!dadosForm.data_nascimento) return null;
                      const age = idadeEm(dadosForm.data_nascimento);
                      if (age < 0 || age >= 18) return null;
                      const termoAssinado = !pendencias.some(p => p.campo === 'termo');
                      const faltaNome = !String(dadosForm.nome_responsavel || '').trim();
                      const faltaCpf = !cpfDigits(dadosForm.cpf_responsavel || '');
                      if (termoAssinado) {
                        return (
                          <div style={{ marginTop: 6, background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 8, padding: '7px 10px', fontSize: '0.75rem', color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span aria-hidden="true">✓</span> Menor de idade — termo do responsável assinado.
                          </div>
                        );
                      }
                      return (
                        <div style={{ marginTop: 6, background: 'rgba(250,204,21,0.10)', border: '1px solid rgba(250,204,21,0.4)', borderRadius: 8, padding: '7px 10px', fontSize: '0.75rem', color: '#854d0e' }}>
                          Menor de idade — Termo de Responsabilidade obrigatório.{' '}
                          {(faltaNome || faltaCpf) && (
                            <span style={{ display: 'block', marginTop: 3 }}>
                              Falta preencher {faltaNome ? 'o nome do responsável' : ''}{faltaNome && faltaCpf ? ' e ' : ''}{faltaCpf ? 'o CPF do responsável' : ''} logo abaixo para poder assinar.
                            </span>
                          )}
                          <button type="button" onClick={() => setActiveTab('termo')} style={{ background: '#854d0e', color: '#fff', border: 'none', borderRadius: 5, padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', marginTop: 4 }}>Assinar Termo →</button>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <label style={ls}>CPF</label>
                    <input value={dadosForm.cpf} onChange={e => setDadosForm(p => ({ ...p, cpf: maskCPF(e.target.value) }))}
                      style={{ ...fs, borderColor: dadosForm.cpf && dadosForm.cpf.replace(/\D/g,'').length === 11 ? (validarCPF(dadosForm.cpf) ? '#86efac' : '#fca5a5') : '#2e2e2e' }}
                      placeholder="000.000.000-00" inputMode="numeric" maxLength={14} />
                    {dadosForm.cpf && dadosForm.cpf.replace(/\D/g,'').length === 11 && (
                      <div style={{ fontSize: '0.7rem', marginTop: 3, fontWeight: 600, color: validarCPF(dadosForm.cpf) ? '#16a34a' : '#dc2626' }}>
                        {validarCPF(dadosForm.cpf) ? '✓ CPF válido' : '✗ CPF inválido — verifique os dígitos'}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={ls}>Identidade (RG)</label>
                    <input value={dadosForm.identidade} onChange={e => setDadosForm(p => ({ ...p, identidade: e.target.value }))} style={fs} placeholder="Número do RG" />
                  </div>
                  <div>
                    <label style={ls}>Numeração Única</label>
                    <input value={dadosForm.numeracao_unica} onChange={e => setDadosForm(p => ({ ...p, numeracao_unica: e.target.value }))}
                      style={fs}
                      placeholder="Ex: 0042 (exclusivo por aluno)" maxLength={20} />
                    <div style={{ fontSize: '0.68rem', color: '#8f8f8f', marginTop: 2 }}>Identificador único no sistema Portal Aluno</div>
                  </div>
                  <div>
                    <label style={ls}>Telefone / WhatsApp</label>
                    <input value={dadosForm.telefone} onChange={e => setDadosForm(p => ({ ...p, telefone: maskPhone(e.target.value) }))} style={fs} placeholder="(21) 99999-0000" inputMode="numeric" maxLength={16} />
                  </div>
                  <div>
                    <label style={ls}>E-mail</label>
                    <input type="email" value={dadosForm.email}
                      onChange={e => setDadosForm(p => ({ ...p, email: e.target.value }))}
                      onBlur={async e => {
                        const val = e.target.value.trim();
                        if (!val || !val.includes('@')) return;
                        try {
                          const r = await fetch(`/api/check-email?email=${encodeURIComponent(val)}&exclude_id=${alvoPerfil}`);
                          const d = await r.json();
                          if (d.exists) {
                            setDadosMsg(`Este e-mail já está cadastrado para outro aluno: ${d.nome}`);
                            setDadosMsgType('error');
                          }
                        } catch { /* silent */ }
                      }}
                      style={fs} placeholder="seu@email.com" />
                    {!dadosForm.email.trim() && (
                      <div style={{ marginTop: 6, background: 'rgba(255,146,0,0.10)', border: '1px solid rgba(255,146,0,0.35)', borderRadius: 8, padding: '8px 12px', fontSize: '0.75rem', color: '#9a3412', lineHeight: 1.5 }}>
                        <strong>Sem e-mail vinculado, você corre o risco de perder o acesso à conta</strong> se esquecer sua senha — sem e-mail não há recuperação automática. Nesse caso, será preciso contatar o admin responsável do seu núcleo para redefinir o acesso.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Endereço ── */}
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                <div style={sec}>Endereço</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={ls}>CEP</label>
                    <input value={dadosForm.cep}
                      onChange={e => setDadosForm(p => ({ ...p, cep: maskCEP(e.target.value) }))}
                      onBlur={e => handleCepBlur(e.target.value)}
                      style={fs} placeholder="00000-000" inputMode="numeric" maxLength={9} />
                    <div style={{ fontSize: '0.68rem', color: '#8f8f8f', marginTop: 2 }}>Endereço preenchido automaticamente ao sair do campo</div>
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={ls}>Logradouro (Rua / Avenida)</label>
                    <input value={dadosForm.endereco} onChange={e => setDadosForm(p => ({ ...p, endereco: e.target.value }))} style={fs} placeholder="Rua, Avenida..." />
                  </div>
                  <div>
                    <label style={ls}>Número</label>
                    <input value={dadosForm.numero} onChange={e => setDadosForm(p => ({ ...p, numero: e.target.value }))} style={fs} placeholder="Nº" />
                  </div>
                  <div>
                    <label style={ls}>Complemento</label>
                    <input value={dadosForm.complemento} onChange={e => setDadosForm(p => ({ ...p, complemento: e.target.value }))} style={fs} placeholder="Apto, Bloco..." />
                  </div>
                  <div>
                    <label style={ls}>Bairro</label>
                    <input value={dadosForm.bairro} onChange={e => setDadosForm(p => ({ ...p, bairro: e.target.value }))} style={fs} placeholder="Bairro" />
                  </div>
                  <div>
                    <label style={ls}>Cidade</label>
                    <input value={dadosForm.cidade} onChange={e => setDadosForm(p => ({ ...p, cidade: e.target.value }))} style={fs} placeholder="Cidade" />
                  </div>
                  <div>
                    <label style={ls}>Estado (UF)</label>
                    <select value={dadosForm.estado} onChange={e => setDadosForm(p => ({ ...p, estado: e.target.value }))} style={fs}>
                      <option value="">— UF —</option>
                      {estados.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Filiação ── */}
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                <div style={sec}>Filiação</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={ls}>Nome do Pai</label>
                    <input value={dadosForm.nome_pai} onChange={e => setDadosForm(p => ({ ...p, nome_pai: e.target.value }))} style={fs} placeholder="Nome completo" />
                  </div>
                  <div>
                    <label style={ls}>Nome da Mãe</label>
                    <input value={dadosForm.nome_mae} onChange={e => setDadosForm(p => ({ ...p, nome_mae: e.target.value }))} style={fs} placeholder="Nome completo" />
                  </div>
                  {(autoTipo === 'Infantil' || (student.menor_de_idade as boolean)) && (
                    <>
                      <div>
                        <label style={ls}>Nome do Responsável Legal</label>
                        <input value={dadosForm.nome_responsavel} onChange={e => setDadosForm(p => ({ ...p, nome_responsavel: e.target.value }))} style={fs} placeholder="Nome completo do responsável" />
                      </div>
                      <div>
                        <label style={ls}>CPF do Responsável</label>
                        <input value={dadosForm.cpf_responsavel} onChange={e => setDadosForm(p => ({ ...p, cpf_responsavel: maskCPF(e.target.value) }))} style={fs} placeholder="000.000.000-00" inputMode="numeric" maxLength={14} />
                      </div>
                    </>
                  )}
                </div>
                {(autoTipo === 'Infantil' || (student.menor_de_idade as boolean)) && (
                  <div style={{ marginTop: 10, background: 'rgba(59,130,246,0.10)', borderRadius: 8, padding: '8px 12px', fontSize: '0.75rem', color: '#93c5fd' }}>
                    Como aluno(a) menor de idade, o Termo de Responsabilidade também deve ser assinado. Acesse a aba <strong>Termo</strong>.
                    <button onClick={() => setActiveTab('termo')} style={{ marginLeft: 8, background: '#FF9200', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>Ver Termo</button>
                  </div>
                )}
              </div>

              {/* ── Desenvolvimento Atípico / Necessidades Específicas ── */}
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                <div style={sec}>Desenvolvimento Atípico / Necessidades Específicas</div>
                <p style={{ fontSize: '0.72rem', color: '#a3a3a3', marginTop: 0, marginBottom: 12 }}>Campo opcional. Selecione todas as condições que se aplicam.</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    'Transtorno do Espectro Autista (TEA)',
                    'Deficiência intelectual',
                    'Dislexia',
                    'Transtorno de ansiedade',
                    'Atraso no desenvolvimento (fala, motor ou cognitivo)',
                    'Deficiência auditiva',
                    'Transtorno Opositivo Desafiador (TOD)',
                    'Epilepsia',
                    'Transtorno de Déficit de Atenção e Hiperatividade (TDAH)',
                    'Síndrome de Down',
                    'Discalculia',
                    'Transtorno de aprendizagem',
                    'Deficiência visual',
                    'Deficiência física motora',
                    'Altas habilidades / superdotação',
                    'Outros',
                  ].map(opt => {
                    const checked = dadosForm.desenvolvimento_atipico.includes(opt);
                    return (
                      <label key={opt} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: '0.78rem', color: '#d4d4d4', padding: '6px 8px', background: checked ? 'rgba(255,146,0,0.07)' : 'transparent', borderRadius: 8, border: `1px solid ${checked ? 'rgba(255,146,0,0.30)' : 'transparent'}`, transition: 'all 0.15s' }}>
                        <input type="checkbox" checked={checked} onChange={e => {
                          if (e.target.checked) setDadosForm(p => ({ ...p, desenvolvimento_atipico: [...p.desenvolvimento_atipico, opt] }));
                          else setDadosForm(p => ({ ...p, desenvolvimento_atipico: p.desenvolvimento_atipico.filter(x => x !== opt) }));
                        }} style={{ marginTop: 2, flexShrink: 0, accentColor: nucleoColor }} />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
                {dadosForm.desenvolvimento_atipico.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: '0.72rem', color: '#FF9200', fontWeight: 600 }}>
                    ✓ {dadosForm.desenvolvimento_atipico.length} condição(ões) selecionada(s)
                  </div>
                )}
              </div>

              <button onClick={handleSaveDados} disabled={dadosLoading}
                style={{ background: dadosLoading ? '#3a3a3a' : 'linear-gradient(135deg, #FF9200, #d97706)', color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontWeight: 800, fontSize: '0.95rem', cursor: dadosLoading ? 'not-allowed' : 'pointer', boxShadow: dadosLoading ? 'none' : '0 4px 14px rgba(255,146,0,0.35)' }}>
                {dadosLoading ? 'Salvando...' : 'Salvar Meus Dados'}
              </button>

              <div style={{ fontSize: '0.72rem', color: '#8f8f8f', textAlign: 'center', lineHeight: 1.5 }}>
                Os dados são salvos diretamente no banco e aparecem no painel administrativo imediatamente.
              </div>
            </div>
          );
        })()}

        {/* ── TERMO DE RESPONSABILIDADE ── */}
        {activeTab === 'termo' && session && student && (() => {
          const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
          const isMenor = menorDeIdade(student.data_nascimento as string, student.menor_de_idade as boolean | null);
          const maskCPFt = (v: string) => {
            const d = v.replace(/\D/g, '').slice(0, 11);
            if (d.length <= 3) return d;
            if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
            if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
            return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
          };
          const handleSaveTermo = async () => {
            if (!termoForm.nome_responsavel.trim()) { setTermoMsg('Preencha o nome do responsável antes de confirmar.'); return; }
            const cpfRespDigits = cpfDigits(termoForm.cpf_responsavel || '');
            if (!cpfRespDigits) { setTermoMsg('O CPF do responsável é obrigatório.'); return; }
            if (!isValidCPF(cpfRespDigits)) { setTermoMsg('CPF do responsável inválido — confira os 11 dígitos.'); return; }
            if (!termoAssinatura) { setTermoMsg('Falta a assinatura do responsável — desenhe no espaço indicado.'); return; }
            // O termo carrega o núcleo no documento; sem núcleo o salvar falha
            // mais tarde com erro genérico — avisar aqui, apontando o preenchimento.
            if (!String(dadosForm.nucleo || '').trim()) {
              setTermoMsg('Falta preencher o Núcleo do aluno em Meus Dados antes de assinar o termo.');
              return;
            }
            setTermoSaving(true); setTermoMsg('');
            try {
              const res = await fetch('/api/aluno/dados', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  student_id: alvoPerfil,
                  nome_responsavel: termoForm.nome_responsavel,
                  cpf_responsavel: termoForm.cpf_responsavel,
                }),
              });
              if (!res.ok) throw new Error('api');
              // Registra assinatura + evidências e marca o termo como assinado
              const resTermo = await fetch(`/api/termo?id=${alvoPerfil}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  nome_responsavel: termoForm.nome_responsavel,
                  cpf_responsavel: termoForm.cpf_responsavel,
                  assinatura_trajeto: termoAssinatura,
                }),
              });
              const dTermo = await resTermo.json().catch(() => ({}));
              if (!resTermo.ok) throw new Error(dTermo.error || 'termo');
              if (dTermo.assinatura_png) setTermoAssinaturaPng(dTermo.assinatura_png);
              setTermoSaved(true);
              setStudent(prev => prev ? { ...prev, nome_responsavel: termoForm.nome_responsavel, cpf_responsavel: termoForm.cpf_responsavel, assinatura_responsavel: true } : prev);
              setTermoMsg('✓ Termo assinado e salvo com sucesso!');
            } catch (e) {
              // 'api' = falha no salvamento dos dados; rede cai no TypeError.
              const msg = e instanceof Error ? e.message : '';
              if (msg && msg !== 'api' && msg !== 'termo') setTermoMsg(msg);
              else if (!String(dadosForm.nucleo || '').trim()) setTermoMsg('Não foi possível salvar — confira se o Núcleo está preenchido em Meus Dados e tente de novo.');
              else setTermoMsg('Erro ao salvar. Tente novamente.');
            }
            setTermoSaving(false);
          };
          const orgNome = sysConfig.organization_name || 'Centro Cultural Luta Negra';
          const assinaturaImg = termoAssinaturaPng;
          const handlePrint = () => {
            const w = window.open('', '_blank', 'width=720,height=900');
            if (!w) return;
            const assinaturaHtml = assinaturaImg
              ? `<div style="text-align:center"><img src="${assinaturaImg}" alt="Assinatura do responsável" width="220" height="71" style="display:block;margin:0 auto" /></div>`
              : '';
            w.document.write(`<!DOCTYPE html><html><head><title>Termo — ${student.nome_completo}</title><style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;padding:20px;color:#111}h1{text-align:center;font-size:1.3rem}p{line-height:1.9;text-align:justify}.box{background:#f9f9f9;border:1px solid #ccc;padding:14px 18px;border-radius:8px;margin-bottom:20px;font-family:sans-serif}.label{font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:#666}.value{font-weight:700;font-size:0.95rem}.sig{margin-top:40px;display:flex;justify-content:space-between;align-items:flex-end}.line{border-top:1px solid #333;width:260px;text-align:center;padding-top:6px;font-size:0.8rem;font-family:sans-serif}.evid{margin-top:26px;font-size:0.68rem;color:#555;font-family:sans-serif;text-align:center;border-top:1px solid #ddd;padding-top:10px}</style></head><body>
              <h1>Termo de Autorização para Prática de Capoeira</h1>
              <p style="text-align:center;font-size:0.9rem;margin-bottom:24px">${orgNome}</p>
              <div class="box">
                <div class="label">Aluno</div><div class="value">${student.nome_completo}</div>
                <div class="label" style="margin-top:8px">Núcleo</div><div class="value">${student.nucleo || '—'}</div>
                <div class="label" style="margin-top:8px">Data de Nascimento</div><div class="value">${student.data_nascimento ? new Date((student.data_nascimento as string)+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</div>
                <div class="label" style="margin-top:8px">Data</div><div class="value">${hoje}</div>
              </div>
              <p>Eu, <strong>${termoForm.nome_responsavel || '________________________'}</strong>, portador(a) do CPF <strong>${termoForm.cpf_responsavel || '___.___.___-__'}</strong>, responsável legal pelo menor <strong>${student.nome_completo}</strong>, autorizo sua participação nas atividades de capoeira realizadas pelo <strong>${orgNome}</strong>, estando ciente das atividades físicas envolvidas, e assumindo a responsabilidade integral pela participação do menor nas referidas atividades.</p>
              <div class="sig">
                <div>
                  ${assinaturaHtml}
                  <div class="line">Assinatura do Responsável</div>
                </div>
                <div class="line">Local e Data</div>
              </div>
              <div class="evid">Documento assinado eletronicamente pelo responsável em ${hoje}, com registro de evidências (data, hora e dispositivo) no sistema ${orgNome === 'Centro Cultural Luta Negra' ? 'do grupo' : ''}. ${assinaturaImg ? 'Assinatura eletrônica reproduzida acima.' : ''}</div>
            </body></html>`);
            w.document.close();
            w.focus();
            setTimeout(() => w.print(), 400);
          };

          if (!isMenor) return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <SectionTitle icon={<IconDoc size={17} />}>Termo de Responsabilidade</SectionTitle>
              <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 16, padding: '32px 20px', textAlign: 'center' }}>
                <div style={{ color: '#4ade80', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><IconStar size={48} strokeWidth={1.6} /></div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#86efac', marginBottom: 6 }}>Não aplicável</div>
                <div style={{ fontSize: '0.82rem', color: '#4ade80', lineHeight: 1.5 }}>
                  Este aluno é maior de idade e não necessita de Termo de Responsabilidade.<br />
                  O termo é obrigatório para alunos menores de 18 anos — incluindo nome completo e CPF do responsável.
                </div>
              </div>
            </div>
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <SectionTitle icon={<IconDoc size={17} />}>Termo de Responsabilidade</SectionTitle>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#a3a3a3' }}>Autorização para prática de capoeira — menor de idade</p>
              </div>

              {/* Status badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: termoSaved ? 'rgba(34,197,94,0.1)' : '#fffbeb', border: `1px solid ${termoSaved ? '#bbf7d0' : '#fde68a'}`, borderRadius: 12, padding: '12px 16px' }}>
                <span style={{ display: 'flex', color: termoSaved ? '#4ade80' : '#FF9200' }}>{termoSaved ? <IconStar size={26} /> : <IconClock size={26} />}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: termoSaved ? '#4ade80' : '#fbbf24' }}>
                    {termoSaved ? 'Termo assinado' : 'Assinatura pendente'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: termoSaved ? '#15803d' : '#78350f' }}>
                    {termoSaved ? `Responsável: ${termoForm.nome_responsavel}` : 'O responsável precisa assinar o termo abaixo'}
                  </div>
                </div>
                {termoSaved && (
                  <button onClick={handlePrint} style={{ marginLeft: 'auto', background: '#FF9200', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>
                    <IconPrinter size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Imprimir / PDF
                  </button>
                )}
              </div>

              {termoMsg && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: termoMsg.startsWith('✓') ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${termoMsg.startsWith('✓') ? 'rgba(34,197,94,0.35)' : 'rgba(220,38,38,0.35)'}`, color: termoMsg.startsWith('✓') ? '#86efac' : '#fca5a5', fontSize: '0.83rem', fontWeight: 600 }}>
                  {termoMsg}
                </div>
              )}

              {/* Documento */}
              <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '2px solid rgba(255,146,0,0.45)', borderRadius: 16, overflow: 'hidden' }}>
                <div style={{ background: '#FF9200', padding: '14px 20px', textAlign: 'center' }}>
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: '0.88rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconWarn size={14} /> Autorização de Participação — Menor de Idade</span>
                  </div>
                </div>
                <div style={{ padding: '24px 22px', fontFamily: 'Georgia, serif' }}>
                  {/* Dados do aluno */}
                  <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '14px 18px', marginBottom: 22, fontFamily: 'sans-serif', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '0.83rem' }}>
                    <div><span style={{ color: '#a3a3a3' }}>Aluno: </span><strong>{student.nome_completo}</strong></div>
                    <div><span style={{ color: '#a3a3a3' }}>Núcleo: </span><strong>{student.nucleo || '—'}</strong></div>
                    <div><span style={{ color: '#a3a3a3' }}>Nascimento: </span><strong>{student.data_nascimento ? new Date((student.data_nascimento as string)+'T12:00:00').toLocaleDateString('pt-BR') : '—'}</strong></div>
                    <div><span style={{ color: '#a3a3a3' }}>Data: </span><strong>{hoje}</strong></div>
                  </div>
                  <p style={{ textAlign: 'justify', lineHeight: 1.9, marginBottom: 22, fontSize: '0.9rem' }}>
                    Eu, responsável legal pelo menor acima identificado, autorizo sua participação nas atividades de capoeira realizadas pelo <strong>{orgNome}</strong>, estando ciente das atividades físicas envolvidas, e assumindo a responsabilidade integral pela participação do menor nas referidas atividades.
                  </p>
                  <hr style={{ border: 'none', borderTop: '1px dashed rgba(0,0,0,0.15)', marginBottom: 20 }} />
                  {/* Campos do responsável */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, fontFamily: 'sans-serif' }}>
                    <div style={{ gridColumn: '1/-1' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                        Nome do Responsável Legal <span style={{ color: '#f87171' }}>*</span>
                      </label>
                      <input value={termoForm.nome_responsavel} onChange={e => setTermoForm(p => ({ ...p, nome_responsavel: e.target.value }))}
                        disabled={termoSaved} placeholder="Nome completo do responsável (pai, mãe ou tutor legal)"
                        style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box', opacity: termoSaved ? 0.7 : 1, fontFamily: 'Georgia, serif' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                        CPF do Responsável <span style={{ color: '#f87171' }}>*</span>
                      </label>
                      <input value={termoForm.cpf_responsavel}
                        onChange={e => setTermoForm(p => ({ ...p, cpf_responsavel: maskCPFt(e.target.value) }))}
                        disabled={termoSaved} placeholder="000.000.000-00" inputMode="numeric" maxLength={14}
                        style={{ width: '100%', border: '1.5px solid #d1d5db', borderRadius: 8, padding: '10px 12px', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box', opacity: termoSaved ? 0.7 : 1 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ fontSize: '0.78rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                        Assinatura eletrônica registrada com data e dispositivo<br />
                        <span style={{ fontSize: '0.7rem' }}>{hoje}</span>
                      </div>
                    </div>
                  </div>

                  {/* Assinatura eletrônica do responsável */}
                  <div style={{ marginTop: 18 }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d4', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                      Assinatura do Responsável <span style={{ color: '#f87171' }}>*</span>
                    </label>
                    {termoSaved ? (
                      termoAssinaturaPng ? (
                        <div style={{ background: '#fff', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: 8, textAlign: 'center' }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={termoAssinaturaPng} alt="Assinatura do responsável" style={{ height: 90, maxWidth: '100%', objectFit: 'contain' }} />
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.78rem', color: '#a3a3a3', border: '1.5px dashed #d1d5db', borderRadius: 10, padding: '18px', textAlign: 'center' }}>
                          Assinatura registrada em {hoje}
                        </div>
                      )
                    ) : (
                      <AssinaturaCanvas
                        onTrajeto={(t, valido) => setTermoAssinatura(valido ? t : '')}
                        altura={150}
                      />
                    )}
                  </div>
                </div>
              </div>

              {!termoSaved ? (
                <button onClick={handleSaveTermo} disabled={termoSaving || !termoForm.nome_responsavel.trim() || !cpfDigits(termoForm.cpf_responsavel || '') || !termoAssinatura}
                  style={{ background: termoForm.nome_responsavel.trim() && cpfDigits(termoForm.cpf_responsavel || '') && termoAssinatura ? `linear-gradient(135deg, #dc2626, #b91c1c)` : '#2e2e2e', color: termoForm.nome_responsavel.trim() && cpfDigits(termoForm.cpf_responsavel || '') && termoAssinatura ? '#fff' : '#9ca3af', border: 'none', borderRadius: 12, padding: '15px', fontWeight: 800, fontSize: '0.95rem', cursor: termoForm.nome_responsavel.trim() && cpfDigits(termoForm.cpf_responsavel || '') && termoAssinatura ? 'pointer' : 'not-allowed', boxShadow: termoForm.nome_responsavel.trim() && cpfDigits(termoForm.cpf_responsavel || '') && termoAssinatura ? '0 4px 14px rgba(220,38,38,0.35)' : 'none' }}>
                  {termoSaving ? 'Salvando...' : 'Confirmar e Assinar Termo'}
                </button>
              ) : (
                <button onClick={handlePrint}
                  style={{ background: 'linear-gradient(135deg, #1e40af, #1d4ed8)', color: '#fff', border: 'none', borderRadius: 12, padding: '15px', fontWeight: 800, fontSize: '0.95rem', cursor: 'pointer', boxShadow: '0 4px 14px rgba(30,64,175,0.3)' }}>
                  <IconPrinter size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />Imprimir / Baixar PDF do Termo
                </button>
              )}

              <div style={{ fontSize: '0.72rem', color: '#8f8f8f', textAlign: 'center', lineHeight: 1.5 }}>
                Este termo é vinculado ao cadastro do aluno e fica visível para o administrador do núcleo.
              </div>
            </div>
          );
        })()}

        {/* ── EVOLUÇÃO / DASHBOARD PESSOAL ── */}
        {activeTab === 'evolucao' && session && (() => {
          // ── helpers ────────────────────────────────────────────────────────
          const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
          const todayStr = today.toISOString().split('T')[0];

          // Frequency per month: { '2025-03': 4, ... }
          const byMonth: Record<string, number> = {};
          for (const d of evolucaoDates) {
            const ym = d.slice(0, 7); // 'YYYY-MM'
            byMonth[ym] = (byMonth[ym] || 0) + 1;
          }

          // Last 6 months including current
          const months6: { key: string; label: string; count: number }[] = [];
          for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            months6.push({ key, label, count: byMonth[key] || 0 });
          }

          const maxCount = Math.max(...months6.map(m => m.count), 1);

          // Last 30 days attendance set
          const last30 = new Set<string>();
          const last30Arr: string[] = [];
          for (let i = 29; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const s = d.toISOString().split('T')[0];
            last30Arr.push(s);
            if (evolucaoDates.includes(s)) last30.add(s);
          }

          const totalDays = evolucaoDates.length;
          const thisMonthKey = todayStr.slice(0, 7);
          const thisMonthCount = byMonth[thisMonthKey] || 0;
          const lastMonthKey = (() => {
            const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          })();
          const lastMonthCount = byMonth[lastMonthKey] || 0;

          // Streak — consecutive days (backwards from today)
          let streak = 0;
          for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const s = d.toISOString().split('T')[0];
            if (evolucaoDates.includes(s)) streak++;
            else if (i > 0) break; // gap found
          }

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <SectionTitle icon={<IconChart size={17} />}>Dashboard de Evolução</SectionTitle>
                <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#a3a3a3' }}>Acompanhe sua frequência e evolução nos treinos</p>
              </div>

              {evolucaoLoading ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#8f8f8f', fontSize: '0.9rem' }}>Carregando dados...</div>
              ) : (
                <>
                  {/* Stats cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                    {[
                      { label: 'Total de treinos', value: totalDays, Icon: IconBerimbau, color: '#FF9200', bg: 'rgba(255,146,0,0.10)', border: 'rgba(255,146,0,0.30)' },
                      { label: 'Este mês', value: thisMonthCount, Icon: IconClock, color: '#c4b5fd', bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.30)' },
                      { label: 'Mês passado', value: lastMonthCount, Icon: IconChart, color: '#67e8f9', bg: 'rgba(34,211,238,0.08)', border: 'rgba(34,211,238,0.28)' },
                      { label: 'Sequência atual', value: `${streak}d`, Icon: IconFlame, color: '#f87171', bg: 'rgba(239,68,68,0.09)', border: 'rgba(248,113,113,0.3)' },
                    ].map(s => (
                      <div key={s.label} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ display: 'flex', color: s.color }}><s.Icon size={26} strokeWidth={1.7} /></span>
                        <div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
                          <div style={{ fontSize: '0.7rem', color: '#a3a3a3', marginTop: 2 }}>{s.label}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Monthly frequency bar chart */}
                  <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f5f5f4', marginBottom: 16 }}>Frequência Mensal</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
                      {months6.map(m => {
                        const heightPct = maxCount > 0 ? (m.count / maxCount) * 100 : 0;
                        const isCurrent = m.key === thisMonthKey;
                        return (
                          <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: isCurrent ? '#FF9200' : '#8f8f8f' }}>{m.count}</div>
                            <div style={{ width: '100%', borderRadius: '6px 6px 0 0', background: isCurrent ? nucleoColor : `${nucleoColor}55`, minHeight: 4, height: `${Math.max(heightPct, 4)}%`, transition: 'height 0.3s' }} />
                            <div style={{ fontSize: '0.6rem', color: isCurrent ? '#FF9200' : '#8f8f8f', fontWeight: isCurrent ? 700 : 400, whiteSpace: 'nowrap' }}>{m.label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Last 30 days calendar grid */}
                  <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f5f5f4', marginBottom: 12 }}>Últimos 30 Dias</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 5 }}>
                      {last30Arr.map(d => {
                        const present = last30.has(d);
                        const isToday = d === todayStr;
                        return (
                          <div key={d} title={new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                            style={{ aspectRatio: '1', borderRadius: 6, background: present ? '#FF9200' : '#1c1c1c', border: isToday ? '2px solid #FF9200' : '2px solid transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', color: present ? '#fff' : '#8f8f8f', fontWeight: 700 }}>
                            {new Date(d + 'T12:00:00').getDate()}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, fontSize: '0.7rem', color: '#8f8f8f' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: nucleoColor, display: 'inline-block' }} /> Treinou</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', display: 'inline-block' }} /> Não treinou</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, border: '2px solid #FF9200', display: 'inline-block' }} /> Hoje</span>
                    </div>
                  </div>

                  {/* Attendance list — last 10 */}
                  {evolucaoDates.length > 0 && (
                    <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', borderRadius: 16, padding: '18px 20px', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f5f5f4', marginBottom: 12 }}>Histórico de Presenças</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {([...evolucaoEntries].length > 0
                          ? [...evolucaoEntries].reverse()
                          : [...evolucaoDates].reverse().map(d => ({ date: d, nucleo: null, local_nome: null, hora: null }))
                        ).slice(0, 10).map(entry => {
                          const localLabel = entry.local_nome || entry.nucleo || null;
                          return (
                            <div key={entry.date} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 10, borderLeft: `3px solid ${nucleoColor}` }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: nucleoColor, flexShrink: 0, marginTop: 5 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f5f5f4', textTransform: 'capitalize' }}>
                                  {new Date(entry.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                                </div>
                                {localLabel && (
                                  <div style={{ fontSize: '0.75rem', color: '#a3a3a3', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                    <span>Núcleo: <strong style={{ color: '#d4d4d4' }}>{localLabel}</strong></span>
                                  </div>
                                )}
                                {entry.hora && (
                                  <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    {entry.hora}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {evolucaoDates.length > 10 && (
                        <div style={{ textAlign: 'center', marginTop: 10, fontSize: '0.75rem', color: '#8f8f8f' }}>
                          e mais {evolucaoDates.length - 10} registros anteriores
                        </div>
                      )}
                    </div>
                  )}

                  {evolucaoDates.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '40px 20px', background: 'rgba(255,255,255,0.05)', borderRadius: 16, border: '2px dashed #2e2e2e' }}>
                      <div style={{ color: '#FF9200', marginBottom: 10, display: 'flex', justifyContent: 'center' }}><IconBerimbau size={48} strokeWidth={1.4} /></div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#d4d4d4' }}>Nenhuma presença registrada</div>
                      <div style={{ fontSize: '0.78rem', color: '#8f8f8f', marginTop: 6, lineHeight: 1.5 }}>
                        Use a aba <strong>Presença</strong> para registrar seus treinos. Eles aparecerão aqui automaticamente.
                      </div>
                    </div>
                  )}

                  {/* Performance tip */}
                  {totalDays > 0 && (
                    <div style={{ background: `${nucleoColor}10`, borderRadius: 12, padding: '14px 16px', border: `1px solid ${nucleoColor}30`, fontSize: '0.8rem', color: '#d4d4d4', lineHeight: 1.6 }}>
                      {streak >= 7 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconFlame size={15} /> <strong>Incrível!</strong> Você está em sequência há {streak} dias. Continue assim!</span>
                      ) : thisMonthCount >= 8 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconStar size={15} /> <strong>Ótima frequência</strong> este mês! {thisMonthCount} treinos registrados.</span>
                      ) : thisMonthCount >= 4 ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconTrend size={15} /> Você treinou {thisMonthCount} vezes este mês. Tente aumentar a frequência para evoluir mais rápido!</span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><IconTrend size={15} /> Frequência regular é chave para a evolução na capoeira. Tente treinar pelo menos 2x por semana.</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

      </main>

      {/* ── Sidebar (menu hambúrguer) — drawer glass ── */}
      {sidebarOpen && (
        <div onClick={e => { if (e.target === e.currentTarget) setSidebarOpen(false); }}
          role="dialog" aria-modal="true" aria-label="Menu"
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(4,4,6,0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex' }}>
          <aside onClick={e => e.stopPropagation()}
            style={{
              width: 'min(312px, 86vw)', height: '100%', position: 'relative',
              background: 'linear-gradient(165deg, rgba(24,24,27,0.94) 0%, rgba(10,10,12,0.96) 100%)',
              backdropFilter: 'blur(22px) saturate(1.25)', WebkitBackdropFilter: 'blur(22px) saturate(1.25)',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', flexDirection: 'column', animation: 'sidebarIn 0.24s cubic-bezier(0.22,1,0.36,1)',
              boxShadow: '18px 0 60px rgba(0,0,0,0.6)',
            }}>
            <style>{`@keyframes sidebarIn { from { transform: translateX(-28px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
            <div aria-hidden="true" style={{ position: 'absolute', top: -70, right: -70, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,146,0,0.16) 0%, rgba(255,146,0,0) 70%)', pointerEvents: 'none' }} />
            {/* Perfil */}
            <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid rgba(255,255,255,0.07)', position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  {student?.foto_url ? (
                    <>
                      <span aria-hidden="true" style={{ position: 'absolute', top: 12, left: 12, width: 58, height: 58, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,146,0,0.35) 0%, rgba(255,146,0,0) 70%)', filter: 'blur(5px)' }} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={student.foto_url} alt="" style={{ position: 'relative', width: 50, height: 50, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,146,0,0.6)', flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,0.45)' }} />
                    </>
                  ) : (
                    <span style={{ width: 50, height: 50, borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, rgba(255,146,0,0.32), rgba(255,146,0,0.10))', border: '1.5px solid rgba(255,146,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF9200', flexShrink: 0 }}>
                      <IconUser size={24} />
                    </span>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '0.98rem', color: '#f5f5f4', lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
                    <div style={{ fontSize: '0.7rem', color: '#FF9200', fontWeight: 600, marginTop: 1 }}>
                      {respOnly ? 'Responsável' : `${student?.graduacao || 'Aluno'}${student?.nucleo ? ` · ${student.nucleo}` : ''}`}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" className="press"
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: '#d4d4d4', cursor: 'pointer' }}>
                  <IconX size={16} />
                </button>
              </div>
              {alunoInscricaoNum != null && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, background: 'rgba(255,146,0,0.08)', border: '1px solid rgba(255,146,0,0.28)', borderRadius: 9, padding: '4px 10px' }}>
                  <span style={{ fontSize: '0.6rem', color: 'rgba(255,146,0,0.85)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>ID</span>
                  <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#ffb84d', letterSpacing: '0.06em' }}>{`CCLN-${String(alunoInscricaoNum).padStart(3, '0')}`}</span>
                </div>
              )}
              {/* Quem está usando? — perfis acessíveis (o próprio + tutelados) */}
              {(perfis.length > 1 || perfis.some(p => p.tipo === 'tutelado')) && !isAdminPreview && (
                <div style={{ marginTop: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 11px' }}>
                  <div style={{ fontSize: '0.62rem', fontWeight: 800, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 7 }}>Quem está usando?</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {perfis.map(pf => {
                      const ativo = pf.student_id === perfilAtivo;
                      return (
                        <button key={pf.student_id} onClick={() => { trocarPerfil(pf.student_id); }} disabled={perfilLoading || ativo} className="press"
                          style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '7px 9px', borderRadius: 10, border: ativo ? '1px solid rgba(255,146,0,0.45)' : '1px solid transparent', background: ativo ? 'rgba(255,146,0,0.10)' : 'transparent', cursor: ativo ? 'default' : 'pointer', textAlign: 'left' }}>
                          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,146,0,0.12)', color: '#FF9200', flexShrink: 0, overflow: 'hidden' }}>
                            {pf.foto_url
                              ? // eslint-disable-next-line @next/next/no-img-element
                                <img src={pf.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              : <IconUser size={14} />}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#f5f5f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pf.nome_completo}</span>
                            <span style={{ display: 'block', fontSize: '0.66rem', color: ativo ? '#ffb84d' : '#8f8f8f', fontWeight: 600 }}>{ativo ? 'Perfil ativo' : pf.tipo === 'tutelado' ? 'Dependente' : pf.tipo === 'responsavel' ? 'Meu perfil · Responsável' : 'Meu perfil'}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {/* Navegação */}
            <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {tabs.filter(t => t.id !== 'conta').map(tab => {
                const TabIcon = TAB_ICONS[tab.id] || IconDoc;
                const isActive = activeTab === tab.id;
                return (
                  <button key={tab.id} onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                    aria-current={isActive ? 'page' : undefined} className="press"
                    style={{
                      position: 'relative', display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                      padding: '11px 12px', borderRadius: 13, border: 'none', cursor: 'pointer', textAlign: 'left',
                      background: isActive ? 'linear-gradient(90deg, rgba(255,146,0,0.16) 0%, rgba(255,146,0,0.05) 100%)' : 'transparent',
                      boxShadow: isActive ? 'inset 2px 0 0 #FF9200' : 'none',
                      color: isActive ? '#ffb84d' : '#d4d4d4',
                    }}>
                    <span style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, flexShrink: 0,
                      background: isActive ? 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.32), rgba(255,146,0,0.08))' : 'rgba(255,255,255,0.05)',
                      border: isActive ? '1px solid rgba(255,146,0,0.35)' : '1px solid rgba(255,255,255,0.07)',
                      color: isActive ? '#FF9200' : '#a3a3a3',
                      boxShadow: isActive ? '0 0 14px rgba(255,146,0,0.18)' : 'none',
                    }}>
                      <TabIcon size={18} />
                    </span>
                    <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: isActive ? 700 : 600 }}>{tab.label}</span>
                    {tab.badge && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0, boxShadow: '0 0 8px rgba(239,68,68,0.5)' }} />}
                  </button>
                );
              })}
            </nav>
            {/* Rodapé: conta e sair */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '10px 10px calc(12px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button onClick={() => { setActiveTab('conta'); setSidebarOpen(false); }} className="press"
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 13, border: 'none', background: 'transparent', color: '#d4d4d4', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: '#a3a3a3' }}>
                  <IconGear size={18} />
                </span>
                <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 600 }}>Minha Conta</span>
              </button>
              {!isAdminPreview && (
                <button onClick={handleLogout} className="press"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 13, border: 'none', background: 'transparent', color: '#f87171', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 11, flexShrink: 0, background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                    <IconLogout size={18} />
                  </span>
                  <span style={{ flex: 1, fontSize: '0.88rem', fontWeight: 700 }}>Sair da conta</span>
                </button>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Navegação inferior flutuante (pill de vidro) */}
      <nav
        aria-label="Navegação principal"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 70, padding: '0 14px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', pointerEvents: 'none' }}
      >
        <div className="glass-nav" style={{ maxWidth: 430, margin: '0 auto', borderRadius: 26, display: 'flex', alignItems: 'stretch', padding: '7px 8px', pointerEvents: 'auto', boxShadow: '0 1px 0 0 rgba(255,255,255,0.07) inset, 0 18px 44px rgba(0,0,0,0.6)' }}>
          {primaryTabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} aria-current={isActive ? 'page' : undefined} className="press"
                style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '5px 2px', border: 'none', background: 'none', cursor: 'pointer', color: isActive ? '#fff' : '#8f8f8f', WebkitTapHighlightColor: 'transparent', borderRadius: 18 }}>
                {isActive && (
                  <span aria-hidden="true" style={{ position: 'absolute', top: 4, width: 44, height: 30, borderRadius: 999, background: 'linear-gradient(135deg, #ffb84d 0%, #FF9200 55%, #f07f00 100%)', boxShadow: '0 4px 18px rgba(255,146,0,0.45), 0 0 12px rgba(255,146,0,0.30)' }} />
                )}
                <span style={{
                  position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 30, borderRadius: 999,
                  fontSize: '1.2rem', lineHeight: 1, transition: 'color 0.15s',
                }}>{(() => { const Ic = TAB_ICONS[tab.id] || IconDoc; return <Ic size={20} />; })()}</span>
                <span style={{ position: 'relative', fontSize: '0.6rem', fontWeight: isActive ? 800 : 500, letterSpacing: '0.02em', whiteSpace: 'nowrap', color: isActive ? '#fff' : '#8f8f8f', textShadow: isActive ? '0 0 10px rgba(255,146,0,0.4)' : 'none' }}>{tab.label}</span>
                {tab.badge && <span style={{ position: 'absolute', top: 2, right: 'calc(50% - 24px)', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', border: '1.5px solid #141416', boxShadow: '0 0 8px rgba(239,68,68,0.5)' }} />}
              </button>
            );
          })}
          <button onClick={() => setSidebarOpen(true)} aria-label="Mais seções" className="press"
            style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '5px 2px', border: 'none', background: 'none', cursor: 'pointer', color: '#8f8f8f', WebkitTapHighlightColor: 'transparent', borderRadius: 18 }}>
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 30, borderRadius: 999, color: '#8f8f8f' }}><IconMenu size={20} /></span>
            <span style={{ fontSize: '0.6rem', fontWeight: 500, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>Menu</span>
            {tabs.filter(t => !primaryTabIds.includes(t.id)).some(t => t.badge) && <span style={{ position: 'absolute', top: 2, right: 'calc(50% - 24px)', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', border: '1.5px solid #141416', boxShadow: '0 0 8px rgba(239,68,68,0.5)' }} />}
          </button>
        </div>
      </nav>
    </div>
  );
}
