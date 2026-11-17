import { autenticarReq } from '../../lib/auth';
import { criarEvento } from '../../lib/googleCalendar';

import supabase from '../../lib/supabase';

export default async function handler(req, res) {
  try {
    /* ======================
       AUTENTICAÇÃO
    ====================== */

    const usuarioAuth = await autenticarReq(req, res);
    if (!usuarioAuth) return;
    const usuarioId = usuarioAuth.id;

    /* ======================
       LISTAR REUNIÕES
    ====================== */

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('reunioes')
        .select('*')
        .eq('usuario_id', usuarioId)
        .order('inicio', { ascending: false });

      if (error) {
        throw error;
      }

      return res.status(200).json({
        ok: true,
        reunioes: data
      });
    }

    /* ======================
       CRIAR REUNIÃO
    ====================== */

    if (req.method === 'POST') {
      const {
        titulo,
        descricao,
        inicio,
        fim,
        plataforma,
        link,
        convidados,   // string "a@x.com, b@y.com"
        criarMeet,    // boolean
        anexoUrl,
        anexoTitulo
      } = req.body || {};

      if (!titulo || !inicio) {
        return res.status(400).json({
          erro: 'Título e data obrigatórios'
        });
      }

      /* ======================
         BUSCAR USUÁRIO
      ====================== */

      const { data: usuario, error: erroUsuario } = await supabase
        .from('usuarios')
        .select('google_refresh_token')
        .eq('id', usuarioId)
        .single();

      if (erroUsuario) {
        throw erroUsuario;
      }

      /* ======================
         GOOGLE CALENDAR
      ====================== */

      let evento = null;

      const listaConvidados = (convidados || '')
        .split(',')
        .map(e => e.trim())
        .filter(Boolean);

      const anexos = anexoUrl
        ? [{ fileUrl: anexoUrl, title: anexoTitulo || 'Anexo' }]
        : [];

      try {
        if (usuario?.google_refresh_token) {
          console.log('Criando evento Google');

          const inicioEvento = new Date(inicio);

          let fimEvento = fim
            ? new Date(fim)
            : new Date(inicioEvento.getTime() + 60 * 60 * 1000);

          if (fimEvento <= inicioEvento) {
            fimEvento = new Date(inicioEvento.getTime() + 60 * 60 * 1000);
          }

          evento = await criarEvento({
            refreshToken: usuario.google_refresh_token,
            titulo,
            descricao,
            inicio: inicioEvento.toISOString(),
            fim: fimEvento.toISOString(),
            convidados: listaConvidados,
            criarMeet: criarMeet !== false,
            anexos
          });

          console.log('Evento criado:', evento?.id);
        }
      } catch (googleError) {
        console.error(
          'GOOGLE ERROR:',
          googleError?.response?.data || googleError?.message || googleError
        );
      }

      /* ======================
         SALVAR REUNIÃO
      ====================== */

      const { data, error } = await supabase
        .from('reunioes')
        .insert({
          usuario_id: usuarioId,
          titulo,
          descricao: descricao || null,
          inicio,
          fim: fim || null,
          plataforma: evento?.meetLink ? 'meet' : (plataforma || null),
          link: evento?.meetLink || evento?.htmlLink || link || null,
          convidados: listaConvidados.length ? listaConvidados.join(',') : null,
          google_event_id: evento?.id || null,
          status: 'AGENDADA'
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      return res.status(200).json({
        ok: true,
        google: !!evento,
        meetLink: evento?.meetLink || null,
        reuniao: data
      });
    }

    return res.status(405).json({
      erro: 'Método não permitido'
    });

  } catch (err) {
    console.error('ERRO REUNIOES:', err);

    return res.status(500).json({ erro: 'Erro interno' });
  }
}