import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// Protege as páginas estáticas restritas. As rotas /api/admin/* fazem a
// própria verificação no servidor (exigirAdmin) — esta camada só evita
// servir o HTML do painel para quem não é admin.
export async function middleware(request) {
  const token = request.cookies.get('tr_token')?.value;
  const secretEnv = process.env.JWT_SECRET;
  const planoAdmin = process.env.ADMIN_PLANO_ID;

  if (!token || !secretEnv || !planoAdmin) {
    return NextResponse.redirect(new URL('/login.html', request.url));
  }

  try {
    const secret = new TextEncoder().encode(secretEnv);
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });

    if (payload.plano_id !== planoAdmin) {
      return NextResponse.redirect(new URL('/dashboard.html', request.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login.html', request.url));
  }
}

export const config = {
  matcher: ['/admin.html', '/demo.html'],
};
