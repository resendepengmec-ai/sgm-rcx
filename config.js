// ── config.js ─────────────────────────────────────────────────────
// FONTE ÚNICA da URL do backend.
//
// Antes, esta URL estava repetida em 10 arquivos HTML: trocar de
// servidor exigia editar todos, e bastava esquecer um para aquela tela
// parar de falar com a API. Agora só se mexe aqui.
//
// Carregue este arquivo SEMPRE antes de api-client.js:
//   <script src="config.js"></script>
//   <script src="api-client.js"></script>

(function () {
  'use strict';

  // URL do backend em produção (sem barra no final).
  // Se um dia o backend mudar de endereço (ex.: api.sgm.eng.br),
  // troque APENAS esta linha.
  var API_PRODUCAO = 'https://smm-backend-a8a4.onrender.com';

  // Rodando local (file://, localhost, 127.0.0.1) continua apontando pro
  // backend de produção — mantém o comportamento que já existia. Se você
  // subir um backend local, ajuste API_LOCAL e ele será usado sozinho.
  var API_LOCAL = API_PRODUCAO;

  // Domínio canônico do sistema. Deixe '' para desativar a normalização.
  var DOMINIO_CANONICO = 'sgm.eng.br';

  var host = location.hostname;
  var ehLocal = (host === 'localhost' || host === '127.0.0.1' || location.protocol === 'file:');

  // ── Normalização de host (www → raiz) ───────────────────────────
  // O login do Google monta o redirect_uri a partir de location.origin.
  // Se a pessoa entrar por www.sgm.eng.br, o redirect vira
  // "https://www.sgm.eng.br/auth-callback.html" — endereço diferente do
  // cadastrado no Google Cloud, e o login quebra com redirect_uri_mismatch.
  // Mandar todo mundo pro domínio raiz mantém uma origem só, o que também
  // simplifica a lista de CORS no backend.
  // Não faz nada em localhost, file:// nem em qualquer outro host (o
  // *.github.io antigo continua funcionando normalmente).
  if (DOMINIO_CANONICO && !ehLocal && host === 'www.' + DOMINIO_CANONICO) {
    location.replace(location.protocol + '//' + DOMINIO_CANONICO +
                     location.pathname + location.search + location.hash);
    return; // não continua: a página está sendo trocada
  }

  // Um override manual em localStorage continua tendo prioridade — útil
  // pra testar contra outro backend sem editar arquivo:
  //   localStorage.setItem('smm_api_url', 'https://outro-backend...')
  var override = null;
  try { override = localStorage.getItem('smm_api_url'); } catch (e) {}

  window.SMM_API = override || (ehLocal ? API_LOCAL : API_PRODUCAO);
})();
