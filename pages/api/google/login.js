import { google } from 'googleapis';
import { pegarUserIdDaReq, assinarState, caminhoRedirectSeguro } from '../../../lib/auth.js';

export default async function handler(req, res) {
  try {
    const userId = pegarUserIdDaReq(req);
    if (!userId) {
      return res.status(401).json({ erro: 'Você precisa estar logado para conectar o Google Calendar' });
    }

    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    // state assinado (JWT de 10 min): o callback só aceita states emitidos aqui
    const state = assinarState({ uid: userId, redirect: caminhoRedirectSeguro(req.query.redirect) });

    const url = oauth.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state,
    });

    return res.redirect(url);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Erro ao conectar Google' });
  }
}
