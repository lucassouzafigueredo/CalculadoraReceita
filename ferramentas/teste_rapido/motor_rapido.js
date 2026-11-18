/* Lógica do teste rápido: replica a crítica oficial NCM/NBS x anexo (NcmAplicavelService / NbsAplicavelService)
   sobre um retrato das tabelas da calculadora. Funciona no navegador e no node (para conferência com a API). */
(function (g) {
  'use strict';
  function vig(ini, fim, data) { return ini <= data && (!fim || data <= fim); }

  function criarMotor(D) {
    const classes = new Map(D.classes.map((c) => [c.codigo, c]));

    // tabela-verdade oficial: rejeita quando !A ou quando (E e !S)
    function valido(codigo, cc, data, regras) {
      const rows = regras.filter((r) => r.c === cc && vig(r.ini, r.fim, data));
      if (!rows.length) return null; // sem anexo: não restringe
      const cobre = rows.filter((r) => codigo.startsWith(r.p));
      if (!cobre.length) return false;
      const E = cobre.some((r) => r.ex.some((e) => vig(e[1], e[2], data) && codigo.startsWith(e[0])));
      const S = cobre.some((r) => !r.ex.some((e) => vig(e[1], e[2], data)));
      return !(E && !S);
    }

    function classesComAnexo(regras, data) {
      return [...new Set(regras.filter((r) => vig(r.ini, r.fim, data)).map((r) => r.c))].filter((c) => classes.has(c));
    }

    function itensAnexo(codigo, cc, data, regras) {
      return regras.filter((r) => r.c === cc && vig(r.ini, r.fim, data) && codigo.startsWith(r.p)).map((r) => r);
    }

    function descricao(codigo, tabela) {
      const limpa = (t) => String(t || '').replace(/^[-\s]+/, '').replace(/<[^>]+>/g, '').trim();
      const niveis = [];
      for (let n = 4; n <= codigo.length; n++) { const d = tabela[codigo.slice(0, n)]; if (d) niveis.push(limpa(d)); }
      if (!niveis.length) return null;
      return niveis.length > 1 ? `${niveis[0]} › ${niveis[niveis.length - 1]}` : niveis[0];
    }

    function sujeitoIS(ncm, data) {
      return D.isNcm.some((r) => ncm.startsWith(r[0]) && vig(r[1], r[2], data)) && !(D.isEx || []).some((r) => ncm.startsWith(r[0]) && vig(r[1], r[2], data));
    }

    function descobrir(tipo, codigo, data) {
      const tabela = tipo === 'NBS' ? D.nbs : D.ncm;
      const regras = tipo === 'NBS' ? D.regrasNbs : D.regrasNcm;
      if (!tabela[codigo]) return { tipo, codigo, erro: `${tipo} ${codigo} não encontrada no cadastro oficial` };
      const candidatas = classesComAnexo(regras, data);
      const aceitas = candidatas.filter((cc) => valido(codigo, cc, data, regras)).map((cc) => classes.get(cc));
      return {
        tipo, codigo, descricao: descricao(codigo, tabela), testadas: candidatas.length, aceitas,
        anexo: (cc) => itensAnexo(codigo, cc, data, regras),
        is: tipo === 'NCM' && sujeitoIS(codigo, data) ? { cst: '000', cclasstrib: '000001', aliquota: null } : null,
      };
    }

    function buscar(texto, limite = 60) {
      const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const out = [];
      for (const [cod, d] of Object.entries(D.ncm)) {
        if (cod.length !== 8) continue;
        const desc = descricao(cod, D.ncm) || '';
        if (desc.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t) || cod.startsWith(texto.replace(/\D/g, '') || 'x')) {
          out.push({ tipo: 'NCM', codigo: cod, descricao: desc });
          if (out.length >= limite) break;
        }
      }
      for (const [cod] of Object.entries(D.nbs)) {
        if (out.length >= limite) break;
        if (cod.length !== 9) continue;
        const desc = descricao(cod, D.nbs) || '';
        if (desc.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(t)) out.push({ tipo: 'NBS', codigo: cod, descricao: desc });
      }
      return out;
    }

    return { descobrir, buscar, valido, classesComAnexo, classes };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { criarMotor };
  else g.criarMotor = criarMotor;
})(typeof window !== 'undefined' ? window : globalThis);
