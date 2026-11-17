// ============================================
// ESTADO GLOBAL DA APLICAÇÃO
// Estas variáveis são compartilhadas por todos os outros
// arquivos .js (scripts clássicos compartilham o mesmo
// escopo léxico global no navegador, então isso continua
// funcionando exatamente como antes).
//
// IMPORTANTE: este arquivo deve ser o PRIMEIRO <script> a
// ser carregado na página.
// ============================================

let perfil = {};
let meetings = [];
let scheduledMeetings = [];
let transcripts = [];
let team = [];

let currentMeetingPage = 1;
const meetingsPerPage = 10;
