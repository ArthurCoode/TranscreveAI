import supabase from './supabase';

export async function salvarRefreshToken(userId, refreshToken) {
  const { error } = await supabase
    .from('usuarios')
    .update({ google_refresh_token: refreshToken })
    .eq('id', userId);

  if (error) {
    console.error('Erro ao salvar refresh_token:', error);
    throw error;
  }
}

export async function buscarRefreshToken(userId) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('google_refresh_token')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Erro ao buscar refresh_token:', error);
    return null;
  }

  return data?.google_refresh_token ?? null;
}
