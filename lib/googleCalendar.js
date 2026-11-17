import { google } from 'googleapis';

export async function criarEvento({
  refreshToken,
  titulo,
  descricao,
  inicio,
  fim,
  convidados = [],   // array de emails
  criarMeet = true,
  anexos = []        // array de { fileUrl, title } — fileUrl precisa ser um link do Google Drive
}) {
  if (!refreshToken) {
    throw new Error('Usuário não possui refresh_token do Google salvo. Reconecte a conta do Google.');
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    auth.setCredentials({ refresh_token: refreshToken });
    await auth.getAccessToken();

    const calendar = google.calendar({ version: 'v3', auth });

    const requestBody = {
      summary: titulo,
      description: descricao || '',
      start: { dateTime: inicio, timeZone: 'America/Sao_Paulo' },
      end: { dateTime: fim, timeZone: 'America/Sao_Paulo' }
    };

    const convidadosValidos = convidados
      .filter(email => !!email && email.includes('@'))
      .map(email => ({ email: email.trim() }));

    if (convidadosValidos.length > 0) {
      requestBody.attendees = convidadosValidos;
    }

    if (criarMeet) {
      requestBody.conferenceData = {
        createRequest: {
          requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      };
    }

    if (anexos.length > 0) {
      requestBody.attachments = anexos
        .filter(a => !!a.fileUrl)
        .map(a => ({
          fileUrl: a.fileUrl,
          title: a.title || 'Anexo'
        }));
    }

    const evento = await calendar.events.insert({
      calendarId: 'primary',
      requestBody,
      conferenceDataVersion: criarMeet ? 1 : 0,
      supportsAttachments: anexos.length > 0,
      sendUpdates: convidadosValidos.length > 0 ? 'all' : 'none'
    });

    const meetLink = evento.data.conferenceData?.entryPoints?.find(
      e => e.entryPointType === 'video'
    )?.uri || null;

    return { ...evento.data, meetLink };

  } catch (err) {
    console.error('GOOGLE INSERT ERROR:', err.response?.data || err.message);
    throw err;
  }
}