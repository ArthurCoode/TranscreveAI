import { google } from 'googleapis';
import { salvarRefreshToken } from '../../../lib/googleTokenStore.js';
import { verificarState, caminhoRedirectSeguro } from '../../../lib/auth.js';

const APP_URL = (process.env.APP_URL || process.env.PUBLIC_BASE_URL || 'https://www.transcreveia.com').replace(/\/+$/, '');

export default async function handler(req, res) {
  const { code, state } = req.query;

  // state precisa ser um JWT emitido por /api/google/login há menos de 10 min
  const dadosState = typeof state === 'string' ? verificarState(state) : null;
  const redirectPath = caminhoRedirectSeguro(dadosState?.redirect);

  if (!dadosState?.uid) {
    console.warn('Callback do Google com state inválido ou expirado.');
    return res.redirect(`${APP_URL}${redirectPath}?google=error`);
  }
  if (!code || typeof code !== 'string') {
    return res.redirect(`${APP_URL}${redirectPath}?google=error`);
  }

  try {
    const oauth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    const { tokens } = await oauth.getToken(code);

    if (!tokens.refresh_token) {
      console.warn('Google não retornou refresh_token (usuário pode já ter autorizado antes).');
      return res.redirect(`${APP_URL}${redirectPath}?google=no_refresh_token`);
    }

    await salvarRefreshToken(dadosState.uid, tokens.refresh_token);
    return res.redirect(`${APP_URL}${redirectPath}?google=connected`);
  } catch (err) {
    console.error('Erro no callback do Google:', err.response?.data || err.message);
    return res.redirect(`${APP_URL}${redirectPath}?google=error`);
  }
}
