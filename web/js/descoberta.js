/*
 * Descoberta da cClassTrib (e do Imposto Seletivo) a partir só da NCM ou NBS,
 * usando exclusivamente os serviços de dados abertos da calculadora oficial:
 *  - mercadorias: para cada cClassTrib que tem anexo de NCM, pergunta à calculadora
 *    se a NCM é aceita (/classificacoes-tributarias/ncm-aplicavel — a mesma regra do REG-011);
 *  - serviços: lista as NBS de cada cClassTrib com anexo (/nbs-aplicaveis);
 *  - Imposto Seletivo e descrição: /ncm e /nbs.
 * Tudo é refeito com a versão da calculadora em uso, então acompanha as atualizações da Receita.
 */
(function (global) {
  'use strict';
  const R = global.Regras;
  const NCM_INEXISTENTE = '99999999';
  const NBS_INEXISTENTE = '999999999';

  function criar({ requisitar, emParalelo, concorrencia = 6 }) {
    const cacheTabelas = new Map(); // data -> Promise<{ todas, anexoNcm, anexoNbs }>
    const cacheItem = new Map(); // tipo|codigo|data -> Promise<resultado>

    function tabelas(data) {
      if (cacheTabelas.has(data)) return cacheTabelas.get(data);
      const p = (async () => {
        const r = await requisitar('GET', `/dados-abertos/classificacoes-tributarias/cbs-ibs?data=${data}`);
        const lista = r.ok && Array.isArray(r.dados) ? r.dados : [];
        const todas = new Map(lista.map((c) => [c.codigo, c]));
        const rf = await requisitar('GET', `/dados-abertos/fundamentacoes-legais?data=${data}`);
        if (rf.ok && Array.isArray(rf.dados)) {
          rf.dados.forEach((f) => {
            const c = todas.get(f.codigoClassificacaoTributaria);
            if (c && !c._fund) c._fund = { textoCurto: f.textoCurto, texto: f.texto };
          });
        }
        const anexoNcm = [];
        const anexoNbs = [];
        const tarefas = [];
        // Uma cClassTrib "tem anexo" quando o validador oficial RECUSA um código inexistente;
        // sem anexo, qualquer código é aceito e ela não restringe nada.
        lista.forEach((c) => {
          const nom = c.nomenclatura || '';
          if (nom.includes('NCM')) {
            tarefas.push(async () => {
              const v = await requisitar('GET', `/dados-abertos/classificacoes-tributarias/ncm-aplicavel?cClassTrib=${c.codigo}&ncm=${NCM_INEXISTENTE}&dataOcorrenciaFatoGerador=${data}`);
              if (v.ok && v.dados && v.dados.valido === false) anexoNcm.push(c);
            });
          }
          if (nom.includes('NBS')) {
            tarefas.push(async () => {
              const v = await requisitar('GET', `/dados-abertos/classificacoes-tributarias/nbs-aplicavel?cClassTrib=${c.codigo}&nbs=${NBS_INEXISTENTE}&dataOcorrenciaFatoGerador=${data}`);
              if (v.ok && v.dados && v.dados.valido === false) anexoNbs.push(c);
            });
          }
        });
        await emParalelo(tarefas, concorrencia, () => {});
        return { todas, anexoNcm, anexoNbs };
      })();
      cacheTabelas.set(data, p);
      return p;
    }

    function descricao(info) {
      if (!info) return '';
      const limpar = (t) => String(t).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const partes = [info.posicao, info.subposicao, info.subposicao1, info.subposicao2, info.item, info.subitem].filter(Boolean);
      if (!partes.length) return limpar(info.capitulo || '');
      return limpar(partes.length > 1 ? `${partes[0]} › ${partes[partes.length - 1]}` : partes[0]);
    }

    async function descobrirNcm(ncm, data) {
      const info = await requisitar('GET', `/dados-abertos/ncm?ncm=${ncm}&data=${data}`);
      if (!info.ok) return { tipo: 'NCM', codigo: ncm, data, erro: (info.dados && (info.dados.detail || info.dados.title)) || 'NCM não encontrada' };
      const { anexoNcm } = await tabelas(data);
      const validas = [];
      await emParalelo(anexoNcm.map((c) => async () => {
        const v = await requisitar('GET', `/dados-abertos/classificacoes-tributarias/ncm-aplicavel?cClassTrib=${c.codigo}&ncm=${ncm}&dataOcorrenciaFatoGerador=${data}`);
        if (v.ok && v.dados && v.dados.valido) validas.push(c);
      }), concorrencia, () => {});
      return montar('NCM', ncm, data, info.dados, validas, anexoNcm.length);
    }

    async function descobrirNbs(nbs, data) {
      const info = await requisitar('GET', `/dados-abertos/nbs?nbs=${nbs}&data=${data}`);
      if (!info.ok) return { tipo: 'NBS', codigo: nbs, data, erro: (info.dados && (info.dados.detail || info.dados.title)) || 'NBS não encontrada' };
      const { anexoNbs } = await tabelas(data);
      const validas = [];
      await emParalelo(anexoNbs.map((c) => async () => {
        const v = await requisitar('GET', `/dados-abertos/classificacoes-tributarias/nbs-aplicavel?cClassTrib=${c.codigo}&nbs=${nbs}&dataOcorrenciaFatoGerador=${data}`);
        if (v.ok && v.dados && v.dados.valido) validas.push(c);
      }), concorrencia, () => {});
      return montar('NBS', nbs, data, info.dados, validas, anexoNbs.length);
    }

    async function montar(tipo, codigo, data, info, validas, testadas) {
      const { todas } = await tabelas(data);
      const sug = R.sugerirClassificacao(validas);
      const classif = sug.classificacao || todas.get(sug.codigo) || null;
      const is = info && info.tributadoPeloImpostoSeletivo
        ? { cst: '000', cclasstrib: '000001', aliquota: info.aliquotaAdValorem ?? null }
        : null;
      return { tipo, codigo, data, descricao: descricao(info), testadas, aceitas: validas, sugestao: { ...sug, classificacao: classif }, is };
    }

    function descobrir(tipo, codigo, data) {
      const k = `${tipo}|${codigo}|${data}`;
      if (!cacheItem.has(k)) cacheItem.set(k, tipo === 'NBS' ? descobrirNbs(codigo, data) : descobrirNcm(codigo, data));
      return cacheItem.get(k);
    }

    /** Descobre uma lista de {tipo, codigo}; aoProgredir(feitos, total). */
    async function descobrirLista(itens, data, aoProgredir) {
      const unicos = [...new Map(itens.map((i) => [`${i.tipo}|${i.codigo}`, i])).values()];
      await tabelas(data);
      const resultados = new Map();
      let feitos = 0;
      await emParalelo(unicos.map((i) => async () => {
        resultados.set(`${i.tipo}|${i.codigo}`, await descobrir(i.tipo, i.codigo, data));
      }), 3, () => { feitos++; if (aoProgredir) aoProgredir(feitos, unicos.length); });
      return resultados;
    }

    return { descobrir, descobrirLista, tabelas };
  }

  global.Descoberta = { criar };
})(window);
