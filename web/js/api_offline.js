/*
 * MODO ONLINE do simulador (GitHub Pages, sem Java): responde às mesmas rotas da calculadora
 * oficial usando um RETRATO das tabelas oficiais (gerado a cada publicação) e as mesmas fórmulas
 * da calculadora (TRATAMENTO_TRIBUTARIO): base = informada − IS informado + IS calculado;
 * tributo = base × alíquota × (1 − redução); arredondamento ao centavo, meio-para-par.
 *
 * Só são calculadas as cClassTrib em DADOS.suportadas: a lista é produzida na publicação
 * comparando, ao centavo, este módulo com a calculadora oficial (scripts/conferir_online.js).
 * As demais retornam NAO_IMPLEMENTADO com orientação para usar o simulador instalado.
 */
(function (g) {
  'use strict';

  // arredondamento meio-para-par (HALF_EVEN), como o ArredondamentoUtils da calculadora
  function arred(x, casas = 2) {
    const f = 10 ** casas;
    const v = Number((x * f).toFixed(6));
    const piso = Math.floor(v);
    const d = v - piso;
    let r;
    if (Math.abs(d - 0.5) < 1e-7) r = piso % 2 === 0 ? piso : piso + 1;
    else r = Math.round(v);
    return r / f;
  }
  const s2 = (x) => arred(x).toFixed(2);

  // elementos da base unificada (ElementoBaseCalculo): [campo, sinal, bases, natureza, anoIni, anoFim]
  const ELEMENTOS = [
    ['vProd', 1, 'RG IS SN', null, 2026, 2033], ['vFrete', 1, 'RG IS SN', null, 2026, 2033],
    ['vSeg', 1, 'RG IS SN', null, 2026, 2033], ['vOutro', 1, 'RG IS SN', null, 2026, 2033],
    ['vII', 1, 'RG IS', 'bem', 2026, 2033], ['vIS', 1, 'RG SN', null, 2027, 2033],
    ['vDesc', -1, 'RG IS SN', null, 2026, 2033], ['vPIS', -1, 'RG IS', null, 2026, 2026],
    ['vCOFINS', -1, 'RG IS', null, 2026, 2026], ['vICMS', -1, 'RG IS', 'bem', 2026, 2032],
    ['vICMSUFDest', -1, 'RG IS', 'bem', 2026, 2032], ['vFCP', -1, 'RG IS', 'bem', 2026, 2032],
    ['vFCPUFDest', -1, 'RG IS', 'bem', 2026, 2032], ['vICMSMono', -1, 'RG IS', 'bem', 2026, 2032],
    ['vISSQN', -1, 'RG IS', 'servico', 2026, 2032],
  ];

  function criarApiOffline(D, criarMotor) {
    const M = criarMotor(D);
    const classes = new Map(D.classes.map((c) => [c.codigo, c]));
    const suportadas = new Set(D.suportadas || []);
    const vig = (ini, fim, data) => ini <= data && (!fim || data <= fim);
    const ok = (dados) => ({ ok: true, status: 200, dados });
    const nok = (status, title, detail) => ({ ok: false, status, dados: { title, detail } });

    function params(caminho) {
      const [rota, qs] = caminho.split('?');
      return { rota, q: Object.fromEntries(new URLSearchParams(qs || '')) };
    }

    function niveis(codigo, tabela) {
      const out = [];
      for (let n = 2; n <= codigo.length; n++) { const d = tabela[codigo.slice(0, n)]; if (d) out.push(String(d).replace(/^[-\s]+/, '')); }
      return out;
    }

    function infoCodigo(codigo, tabela, data, ehNcm) {
      if (!tabela[codigo]) return null;
      const n = niveis(codigo, tabela);
      const info = { tributadoPeloImpostoSeletivo: ehNcm && sujeitoIS(codigo, data), temAliquotaAdValorem: false };
      info.capitulo = n[0];
      if (n.length > 1) info.posicao = n[1];
      if (n.length > 2) info.subitem = n[n.length - 1];
      return info;
    }

    function sujeitoIS(ncm, data) {
      const cobre = D.isNcm.some((r) => ncm.startsWith(r[0]) && vig(r[1], r[2], data));
      const excecao = (D.isEx || []).some((r) => ncm.startsWith(r[0]) && vig(r[1], r[2], data));
      return cobre && !excecao;
    }

    function aliquotasRef(data) {
      const v = (t) => { const r = D.aliqRef.find((a) => a.tributo === t && vig(a.ini, a.fim, data)); return r ? r.valor : null; };
      return { cbs: v('CBS'), uf: v('IBSUF'), mun: v('IBSMun') };
    }

    function baseUnificada(b) {
      const ano = b.anoFatoGerador;
      const nat = b.natureza;
      const tot = { RG: 0, IS: 0, SN: 0 };
      const avisos = [];
      ELEMENTOS.forEach(([campo, sinal, bases, natureza, ini, fim]) => {
        const v = Number(b[campo] || 0);
        if (!v) return;
        if (ano < ini || ano > fim) { avisos.push(`Campo ${campo} não compõe as bases para o ano ${ano} (vigência ${ini}–${fim}) e foi ignorado no cálculo`); return; }
        if (natureza && natureza !== nat) return;
        bases.split(' ').forEach((k) => { tot[k] += sinal * v; });
      });
      return { baseRG: arred(tot.RG, 8), baseIS: arred(tot.IS, 8), baseSN: arred(tot.SN, 8), avisos };
    }

    function erro(item, idx, code, campo, title, detail) {
      return { nObj: item.numero, estadoItem: 'INCONSISTENCIA_ENTRADA', erros: [{ code, title, detail, pointer: `#/itens/${idx}/${campo}` }] };
    }

    function calcularItem(item, idx, data, ano) {
      const c = classes.get(item.cClassTrib);
      if (!c) return erro(item, idx, 'REG-005', 'cClassTrib', 'Classificação não encontrada', `Classificação tributária não encontrada para código ${item.cClassTrib} e data ${data} (CBS e IBS)`);
      if (item.cClassTrib.slice(0, 3) !== item.cst) return erro(item, idx, 'REG-006', 'cClassTrib', 'Classificação não vinculada ao CST', `Classificação tributária (cClassTrib) de código ${item.cClassTrib} não está vinculada à situação tributária (CST) ${item.cst}`);
      if (item.ncm && M.valido(item.ncm, c.codigo, data, D.regrasNcm) === false) return erro(item, idx, 'REG-011', 'ncm', 'NCM não vinculada', `NCM de código ${item.ncm} não vinculada à Classificação Tributária de código ${c.codigo} (CBS e IBS)`);
      if (item.nbs && M.valido(item.nbs, c.codigo, data, D.regrasNbs) === false) return erro(item, idx, 'REG-012', 'nbs', 'NBS não vinculada', `NBS de código ${item.nbs} não vinculada à Classificação Tributária de código ${c.codigo} (CBS e IBS)`);
      if (!suportadas.has(c.codigo)) {
        return { nObj: item.numero, estadoItem: 'NAO_IMPLEMENTADO', erros: [{ code: 'ONLINE', title: 'Não disponível no modo online', detail: `A cClassTrib ${c.codigo} (${(D.trat[c.codigo] || {}).desc || c.descricao}) não é calculada na versão online. Use o simulador instalado (pacote Windows), que usa a calculadora oficial.`, pointer: `#/itens/${idx}/cClassTrib` }] };
      }
      const t = D.trat[c.codigo] || { bc: 'baseCalculoInformada-impostoSeletivoInformado+impostoSeletivoCalculado', al: 'aliquota' };

      // alíquotas
      let al;
      if (ano >= 2027) {
        const a = item.aliquotasNominais;
        if (!a || a.cbs === undefined || a.ibsEstadual === undefined || a.ibsMunicipal === undefined) {
          return erro(item, idx, 'REG-037', 'aliquotasNominais', 'Alíquotas nominais obrigatórias', 'As alíquotas nominais (os três campos cbs, ibsEstadual e ibsMunicipal) devem ser informadas para operações a partir de 2027');
        }
        al = { cbs: Number(a.cbs), uf: Number(a.ibsEstadual), mun: Number(a.ibsMunicipal) };
      } else al = aliquotasRef(data);
      if (t.al === '0') al = { cbs: 0, uf: 0, mun: 0 };

      // Imposto Seletivo
      let vIS = 0, grupoIS = null;
      const isItem = item.impostoSeletivo;
      if (ano >= 2027 && !isItem && item.ncm && sujeitoIS(item.ncm, data)) {
        return erro(item, idx, 'REG-013', 'impostoSeletivo', 'Dados do Imposto Seletivo não informados', `Os dados do Imposto Seletivo são obrigatórios para a NCM ${item.ncm} e não foram informados.`);
      }
      if (isItem && ano >= 2027 && item.baseCalculo !== undefined && item.baseCalculo !== null && Number(item.baseCalculo) < Number(isItem.baseCalculo)) {
        return erro(item, idx, 'REG-027', 'baseCalculo', 'Base de cálculo menor que a base de cálculo do Imposto Seletivo', 'A base de cálculo de CBS e IBS informada é menor que a base de cálculo do Imposto Seletivo.');
      }
      if (isItem && ano >= 2027) {
        const adv = item.aliquotasNominais && item.aliquotasNominais.impostoSeletivo ? Number(item.aliquotasNominais.impostoSeletivo.adValorem || 0) : 0;
        vIS = arred(Number(isItem.baseCalculo) * adv / 100, 8); // precisão interna (8 casas)
        grupoIS = { CSTIS: isItem.cst, cClassTribIS: isItem.cClassTrib, vBCIS: s2(isItem.baseCalculo), pIS: adv.toFixed(2), vIS: s2(vIS) };
      }
      let baseInf = item.baseCalculo;
      let base;
      if (baseInf === undefined || baseInf === null) {
        if (!isItem || ano < 2027) return erro(item, idx, 'REG-025', 'baseCalculo', 'Base de cálculo não informada', 'A base de cálculo de CBS e IBS deve ser informada quando o grupo do Imposto Seletivo não é informado');
        baseInf = Number(isItem.baseCalculo);
        base = baseInf + vIS; // base derivada = base do IS + IS calculado
      } else {
        base = Number(baseInf) - Number((isItem && ano >= 2027 && isItem.impostoInformado) || 0) + vIS;
      }
      if (/\*0\.5$/.test(t.bc)) base = Number(baseInf) * 0.5;
      if (/\(1-100\/100\)/.test(t.bc)) base = 0;

      const tributo = (p, red) => {
        const ef = p * (1 - red / 100);
        const grupo = { v: arred(base * ef / 100), p, red, ef };
        return grupo;
      };
      const cbs = tributo(al.cbs, c.percentualReducaoCbs || 0);
      const uf = tributo(al.uf, c.percentualReducaoIbsUf || 0);
      const mun = tributo(al.mun, c.percentualReducaoIbsMun || 0);
      const red = (x) => (x.red ? { gRed: { pRedAliq: x.red.toFixed(2), pAliqEfet: s2(x.ef) } } : {});
      const tribCalc = {
        IBSCBS: {
          CST: item.cst, cClassTrib: item.cClassTrib,
          gIBSCBS: {
            vBC: s2(base),
            gIBSUF: { pIBSUF: al.uf.toFixed(2), ...red(uf), vIBSUF: s2(uf.v) },
            gIBSMun: { pIBSMun: al.mun.toFixed(2), ...red(mun), vIBSMun: s2(mun.v) },
            vIBS: s2(uf.v + mun.v),
            gCBS: { pCBS: al.cbs.toFixed(2), ...red(cbs), vCBS: s2(cbs.v) },
          },
        },
      };
      if (grupoIS) tribCalc.IS = grupoIS;
      return { nObj: item.numero, estadoItem: ano >= 2027 ? 'CALCULO_SIMULADO' : 'CALCULADO', tribCalc };
    }

    function regimeGeral(op) {
      const data = String(op.dhFatoGerador || '').slice(0, 10);
      const ano = Number(data.slice(0, 4));
      const objetos = (op.itens || []).map((it, i) => calcularItem(it, i, data, ano));
      return { objetos };
    }

    async function requisitar(metodo, caminho, corpo) {
      const { rota, q } = params(caminho);
      const data = q.data || q.dataOcorrenciaFatoGerador;
      switch (rota) {
        case '/dados-abertos/versao': return ok({ ...D.versao, ambiente: 'online (retrato)' });
        case '/dados-abertos/classificacoes-tributarias/cbs-ibs': return ok(D.classes);
        case '/dados-abertos/fundamentacoes-legais':
          return ok(D.classes.filter((c) => c._fund).map((c) => ({ codigoClassificacaoTributaria: c.codigo, textoCurto: c._fund.textoCurto, texto: c._fund.texto })));
        case '/dados-abertos/ncm': {
          const i = infoCodigo(q.ncm, D.ncm, data, true);
          return i ? ok(i) : nok(404, 'NCM não encontrada', `NCM de código ${q.ncm} não encontrada para a data ${data}`);
        }
        case '/dados-abertos/nbs': {
          const i = infoCodigo(q.nbs, D.nbs, data, false);
          return i ? ok(i) : nok(404, 'NBS não encontrada', `NBS de código ${q.nbs} não encontrada para a data ${data}`);
        }
        case '/dados-abertos/classificacoes-tributarias/ncm-aplicavel':
          return ok({ cClassTrib: q.cClassTrib, ncm: q.ncm, valido: M.valido(q.ncm, q.cClassTrib, data, D.regrasNcm) !== false });
        case '/dados-abertos/classificacoes-tributarias/nbs-aplicavel':
          return ok({ cClassTrib: q.cClassTrib, nbs: q.nbs, valido: M.valido(q.nbs, q.cClassTrib, data, D.regrasNbs) !== false });
        case '/base-calculo/base-calculo-unificada': return ok(baseUnificada(corpo));
        case '/observabilidade/regime-geral': return ok(regimeGeral(corpo));
        default: return nok(404, 'Rota não disponível no modo online', rota);
      }
    }

    return { requisitar, regimeGeral, baseUnificada, arred };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { criarApiOffline };
  else g.criarApiOffline = criarApiOffline;
})(typeof window !== 'undefined' ? window : globalThis);
