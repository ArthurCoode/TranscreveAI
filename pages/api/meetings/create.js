import { criarEvento } from '../../../lib/googleCalendar.js';
import { buscarRefreshToken } from '../../../lib/googleTokenStore.js';
import { autenticarReq } from '../../../lib/auth.js';

export default async function handler(req, res) {
  const payload = await autenticarReq(req, res);
  if (!payload) return;

  const userId = payload.id;

  try {
    const {
      titulo,
      descricao,
      inicio,
      fim,
      convidados,     // string "a@x.com, b@y.com" ou array
      criarMeet,
      anexoUrl,
      anexoTitulo
    } = req.body;

    if (!titulo || !inicio || !fim) {
      return res.status(400).json({ erro: 'Título, início e término são obrigatórios.' });
    }

    const refreshToken = await buscarRefreshToken(userId);

    if (!refreshToken) {
      return res.status(400).json({
        erro: 'Google Calendar não conectado. Conecte sua conta antes de agendar.'
      });
    }

    const listaConvidados = Array.isArray(convidados)
      ? convidados
      : (convidados || '').split(',').map(e => e.trim()).filter(Boolean);

    const anexos = anexoUrl
      ? [{ fileUrl: anexoUrl, title: anexoTitulo || 'Anexo' }]
      : [];

    const evento = await criarEvento({
      refreshToken,
      titulo,
      descricao,
      inicio,
      fim,
      convidados: listaConvidados,
      criarMeet: criarMeet !== false,
      anexos
    });

    return res.status(200).json({ sucesso: true, evento });

  } catch (err) {
    console.error('Erro ao criar reunião:', err);
    return res.status(500).json({ erro: 'Erro ao agendar reunião no Google Calendar' });
  }
}