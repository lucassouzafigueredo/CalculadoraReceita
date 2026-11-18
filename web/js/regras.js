/*
 * Regras de negócio do simulador (funções puras, sem acesso à tela nem à rede).
 * Toda a regra TRIBUTÁRIA (bases, reduções, alíquotas efetivas, IS) vem da calculadora
 * oficial. Aqui ficam apenas: layout da planilha, validação de formato, montagem das
 * requisições e a conta gerencial (carga atual x nova, receita líquida, margem).
 */
(function (global) {
  'use strict';

  const ANOS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];

  const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB',
    'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

  /*
   * Premissas padrão por ano (editáveis na tela e na aba "Premissas" da planilha).
   * - 2026: alíquotas oficiais de teste vêm da própria calculadora (não podem ser informadas)
   *   e são compensáveis com PIS/COFINS -> não entram como custo (considerar_cbs_ibs = 0).
   * - 2027-2028: CBS cheia menos 0,1 p.p.; IBS de teste 0,1% (0,05 UF + 0,05 Mun);
   *   PIS/COFINS extintos; IPI zerado (exceto ZFM).
   * - 2029-2032: IBS cresce 10/20/30/40% da alíquota de referência e ICMS/ISS caem na mesma proporção.
   * - 2033: regime pleno. Alíquotas de referência estimadas: CBS 8,8% e IBS 17,7%
   *   (repartição UF/Mun ilustrativa 14,9/2,8, proporcional à arrecadação atual de ICMS e ISS).
   */
  const PREMISSAS_PADRAO = [
    { ano: 2026, cbs: null, ibs_uf: null, ibs_mun: null, fator_pis_cofins: 1, fator_icms_iss: 1, fator_ipi: 1, considerar_cbs_ibs: 0 },
    { ano: 2027, cbs: 8.7, ibs_uf: 0.05, ibs_mun: 0.05, fator_pis_cofins: 0, fator_icms_iss: 1, fator_ipi: 0, considerar_cbs_ibs: 1 },
    { ano: 2028, cbs: 8.7, ibs_uf: 0.05, ibs_mun: 0.05, fator_pis_cofins: 0, fator_icms_iss: 1, fator_ipi: 0, considerar_cbs_ibs: 1 },
    { ano: 2029, cbs: 8.8, ibs_uf: 1.49, ibs_mun: 0.28, fator_pis_cofins: 0, fator_icms_iss: 0.9, fator_ipi: 0, considerar_cbs_ibs: 1 },
    { ano: 2030, cbs: 8.8, ibs_uf: 2.98, ibs_mun: 0.56, fator_pis_cofins: 0, fator_icms_iss: 0.8, fator_ipi: 0, considerar_cbs_ibs: 1 },
    { ano: 2031, cbs: 8.8, ibs_uf: 4.47, ibs_mun: 0.84, fator_pis_cofins: 0, fator_icms_iss: 0.7, fator_ipi: 0, considerar_cbs_ibs: 1 },
    { ano: 2032, cbs: 8.8, ibs_uf: 5.96, ibs_mun: 1.12, fator_pis_cofins: 0, fator_icms_iss: 0.6, fator_ipi: 0, considerar_cbs_ibs: 1 },
    { ano: 2033, cbs: 8.8, ibs_uf: 14.9, ibs_mun: 2.8, fator_pis_cofins: 0, fator_icms_iss: 0, fator_ipi: 0, considerar_cbs_ibs: 1 },
  ];

  const COLUNAS_PREMISSAS = [
    ['ano', 'Ano'],
    ['cbs', 'CBS %'],
    ['ibs_uf', 'IBS UF %'],
    ['ibs_mun', 'IBS Mun %'],
    ['fator_pis_cofins', 'Fator PIS/COFINS'],
    ['fator_icms_iss', 'Fator ICMS/ISS'],
    ['fator_ipi', 'Fator IPI'],
    ['considerar_cbs_ibs', 'Considerar CBS/IBS como custo (1/0)'],
  ];

  // tipo: txt | cod | num | data. obrig: S (sim) | C (condicional) | N (não)
  const COLUNAS = [
    { c: 'id_operacao', obrig: 'N', tipo: 'txt', d: 'Identificador da operação/nota. Itens com o mesmo id, UF e município são calculados juntos. Se vazio, cada linha vira uma operação.', ex: 'NF-1001' },
    { c: 'data_fato_gerador', obrig: 'N', tipo: 'data', d: 'Data da venda (AAAA-MM-DD). Nas simulações por ano, o simulador troca só o ano. Se vazio, usa 01/01.', ex: '2027-03-10' },
    { c: 'uf', obrig: 'N', tipo: 'txt', d: 'UF do local da operação (destino). Se UF e município ficarem vazios, usa SP / São Paulo (com alerta).', ex: 'RS' },
    { c: 'municipio_ibge', obrig: 'N', tipo: 'cod', d: 'Código IBGE do município (7 dígitos).', ex: '4314902' },
    { c: 'sku', obrig: 'N', tipo: 'txt', d: 'Código do produto ou serviço. Se vazio, usa a NCM/NBS.', ex: 'ARROZ-5KG' },
    { c: 'descricao', obrig: 'N', tipo: 'txt', d: 'Descrição do item.', ex: 'Arroz tipo 1' },
    { c: 'cliente', obrig: 'N', tipo: 'txt', d: 'Cliente (para análise por cliente).', ex: 'Cliente A' },
    { c: 'canal', obrig: 'N', tipo: 'txt', d: 'Canal de venda (para análise por canal).', ex: 'Varejo' },
    { c: 'ncm', obrig: 'C', tipo: 'cod', d: 'NCM (8 dígitos). Obrigatório para mercadorias.', ex: '10063021' },
    { c: 'nbs', obrig: 'C', tipo: 'cod', d: 'NBS (9 dígitos). Obrigatório para serviços (no lugar da NCM).', ex: '' },
    { c: 'cst', obrig: 'N', tipo: 'cod', d: 'CST do IBS/CBS (3 dígitos). Se vazio junto com cclasstrib, é DESCOBERTO pela NCM/NBS.', ex: '200' },
    { c: 'cclasstrib', obrig: 'N', tipo: 'cod', d: 'Classificação tributária (6 dígitos; os 3 primeiros = CST). Se vazio, o simulador descobre pela NCM/NBS na calculadora oficial (veja a coluna origem no resultado).', ex: '200003' },
    { c: 'quantidade', obrig: 'N', tipo: 'num', d: 'Quantidade (padrão 1).', ex: 20 },
    { c: 'unidade', obrig: 'N', tipo: 'txt', d: 'Unidade (UN, KG, LT...; padrão UN).', ex: 'KG' },
    { c: 'valor_produto', obrig: 'C', tipo: 'num', d: 'Valor do produto/serviço na nota hoje (R$), com ICMS/PIS/COFINS "por dentro" e sem IPI. Usado para a calculadora derivar a base de cálculo oficial de cada ano.', ex: 100 },
    { c: 'frete', obrig: 'N', tipo: 'num', d: 'Frete cobrado (R$).', ex: 0 },
    { c: 'seguro', obrig: 'N', tipo: 'num', d: 'Seguro cobrado (R$).', ex: 0 },
    { c: 'outras_despesas', obrig: 'N', tipo: 'num', d: 'Outras despesas acessórias (R$).', ex: 0 },
    { c: 'desconto', obrig: 'N', tipo: 'num', d: 'Desconto incondicional (R$).', ex: 0 },
    { c: 'base_calculo', obrig: 'N', tipo: 'num', d: 'Opcional: base de cálculo da CBS/IBS já conhecida (R$). Se preenchida, é usada em todos os anos no lugar da base derivada.', ex: '' },
    { c: 'receita_bruta', obrig: 'N', tipo: 'num', d: 'Opcional: total pago pelo cliente hoje (R$). Se vazio = valor_produto + frete + seguro + outras - desconto + IPI.', ex: '' },
    { c: 'custo_total', obrig: 'N', tipo: 'num', d: 'Custo do item (R$), para margem bruta.', ex: 70 },
    { c: 'pis', obrig: 'N', tipo: 'num', d: 'PIS da operação hoje (R$).', ex: 0 },
    { c: 'cofins', obrig: 'N', tipo: 'num', d: 'COFINS da operação hoje (R$).', ex: 0 },
    { c: 'icms', obrig: 'N', tipo: 'num', d: 'ICMS (+FCP) da operação hoje (R$).', ex: 7 },
    { c: 'iss', obrig: 'N', tipo: 'num', d: 'ISS da operação hoje (R$).', ex: 0 },
    { c: 'ipi', obrig: 'N', tipo: 'num', d: 'IPI da operação hoje (R$).', ex: 0 },
    { c: 'is_cst', obrig: 'N', tipo: 'cod', d: 'Imposto Seletivo: CST (3 dígitos). Só para produtos sujeitos ao IS (a partir de 2027).', ex: '' },
    { c: 'is_cclasstrib', obrig: 'N', tipo: 'cod', d: 'Imposto Seletivo: cClassTrib (6 dígitos).', ex: '' },
    { c: 'is_aliquota', obrig: 'N', tipo: 'num', d: 'Imposto Seletivo: alíquota ad valorem (%).', ex: '' },
    { c: 'is_base_calculo', obrig: 'N', tipo: 'num', d: 'Imposto Seletivo: base (R$). Se vazio, usa a base oficial derivada pela calculadora.', ex: '' },
  ];

  // Linhas de exemplo (as 3 primeiras reproduzem docs/exemplos.md da calculadora oficial).
  const EXEMPLOS = [
    { id_operacao: 'NF-1001', data_fato_gerador: '2027-03-10', uf: 'RS', municipio_ibge: '4314902', sku: 'ARROZ-5KG', descricao: 'Arroz (cesta básica, redução 100%)', cliente: 'Supermercado A', canal: 'Varejo', ncm: '10063021', nbs: '', cst: '200', cclasstrib: '200003', quantidade: 20, unidade: 'KG', valor_produto: 100, custo_total: 70, icms: 7, pis: 0, cofins: 0 },
    { id_operacao: 'NF-1001', data_fato_gerador: '2027-03-10', uf: 'RS', municipio_ibge: '4314902', sku: 'CERVEJA-12L', descricao: 'Cerveja (sujeita ao Imposto Seletivo)', cliente: 'Supermercado A', canal: 'Varejo', ncm: '22030000', nbs: '', cst: '000', cclasstrib: '000001', quantidade: 12, unidade: 'LT', valor_produto: 150, custo_total: 80, icms: 37.5, pis: 3.11, cofins: 14.34, ipi: 9, is_cst: '000', is_cclasstrib: '000001', is_aliquota: 10 },
    { id_operacao: 'NFS-2001', data_fato_gerador: '2027-03-10', uf: 'RS', municipio_ibge: '4314902', sku: 'CURSO-ANUAL', descricao: 'Serviço de educação (redução 60%)', cliente: 'Aluno B', canal: 'Serviços', ncm: '', nbs: '122011200', cst: '200', cclasstrib: '200028', quantidade: 1, unidade: 'UN', valor_produto: 1200, custo_total: 600, iss: 24, pis: 7.8, cofins: 36 },
    { id_operacao: 'NF-3001', data_fato_gerador: '2027-03-10', uf: 'SP', municipio_ibge: '3550308', sku: 'NOTEBOOK-15', descricao: 'Notebook (tributação integral)', cliente: 'Empresa C', canal: 'B2B', ncm: '84713012', nbs: '', cst: '000', cclasstrib: '000001', quantidade: 1, unidade: 'UN', valor_produto: 5000, custo_total: 3800, icms: 600, pis: 82.5, cofins: 380, ipi: 0 },
    { sku: 'EXEMPLO-MINIMO', descricao: 'Exemplo mínimo: só NCM e valor (cClassTrib descoberta pela NCM)', ncm: '33051000', valor_produto: 30 },
    { id_operacao: 'NF-3001', data_fato_gerador: '2027-03-10', uf: 'SP', municipio_ibge: '3550308', sku: 'CARNE-ERRO', descricao: 'Exemplo com erro proposital (NCM incompatível com a cClassTrib)', cliente: 'Empresa C', canal: 'B2B', ncm: '02013000', nbs: '', cst: '200', cclasstrib: '200035', quantidade: 1, unidade: 'KG', valor_produto: 80, custo_total: 60, icms: 9.6 },
  ];

  const LIMITE_ITENS_POR_OPERACAO = 50;
  const LOCAL_PADRAO = { uf: 'SP', municipio: '3550308', nome: 'São Paulo' };

  // ---------- descoberta da cClassTrib pela NCM/NBS ----------
  // cClassTrib cujo benefício depende de QUEM compra ou de uma operação específica
  // (órgão público, diferimento, fornecedor específico): nunca são sugeridas sozinhas,
  // apenas listadas como alternativas.
  const CONDICIONAL = /administra[cç][aã]o p[uú]blica|[oó]rg[aã]os|diferimento|segurança da informa|sociedades/i;
  const INTEGRAL = { codigo: '000001', cst: '000' };

  /**
   * Recebe as classificações (objetos da API /classificacoes-tributarias/cbs-ibs) que a
   * calculadora oficial aceitou para a NCM/NBS e devolve a sugestão.
   * situacao: AUTOMATICA (uma opção clara) | REVISAR (mais de uma, ou só condicionais) | INTEGRAL
   */
  function sugerirClassificacao(validas) {
    const gerais = validas.filter((c) => !CONDICIONAL.test(c.descricao || ''));
    const condicionais = validas.filter((c) => CONDICIONAL.test(c.descricao || ''));
    const ordenar = (lista) => [...lista].sort((a, b) => (b.percentualReducaoCbs || 0) - (a.percentualReducaoCbs || 0) || a.codigo.localeCompare(b.codigo));
    if (gerais.length) {
      const [melhor, ...resto] = ordenar(gerais);
      return {
        codigo: melhor.codigo, cst: melhor.codigo.slice(0, 3), classificacao: melhor,
        situacao: resto.length || condicionais.length ? 'REVISAR' : 'AUTOMATICA',
        alternativas: [...ordenar(resto), ...ordenar(condicionais)],
        observacao: resto.length ? 'Produto consta em mais de um anexo; sugerida a maior redução. Confira a descrição do anexo.'
          : condicionais.length ? 'Também há tratamento específico para certos compradores (ver alternativas).' : 'Único tratamento com benefício para esta NCM.',
      };
    }
    return {
      codigo: INTEGRAL.codigo, cst: INTEGRAL.cst, classificacao: null,
      situacao: condicionais.length ? 'REVISAR' : 'INTEGRAL',
      alternativas: ordenar(condicionais),
      observacao: condicionais.length ? 'Benefício só para compradores/operações específicas (ver alternativas); sugerida tributação integral.'
        : 'NCM fora dos anexos de redução: tributação integral.',
    };
  }

  /** Alíquota efetiva estimada (%) = alíquota nominal da premissa x (1 - redução). */
  function aliquotaEfetiva(classif, prem) {
    if (!prem || prem.cbs === null) return null;
    const red = (k) => (classif ? (classif[k] || 0) : 0) / 100;
    return prem.cbs * (1 - red('percentualReducaoCbs')) + prem.ibs_uf * (1 - red('percentualReducaoIbsUf')) + prem.ibs_mun * (1 - red('percentualReducaoIbsMun'));
  }

  const arred4 = (n) => (n === null || n === undefined ? null : Math.round(n * 10000) / 10000);
  const fmt = (n) => (n === null || n === undefined ? '–' : n.toLocaleString('pt-BR', { maximumFractionDigits: 4 }));

  function motivoAlternativa(alt, escolhida) {
    if (CONDICIONAL.test(alt.descricao || '')) return 'Depende de comprador/operação específica (ex.: órgão público, diferimento); use só se a venda se enquadrar.';
    if (escolhida && (alt.percentualReducaoCbs || 0) < (escolhida.percentualReducaoCbs || 0)) return `Redução menor (${fmt(alt.percentualReducaoCbs)}% contra ${fmt(escolhida.percentualReducaoCbs)}%).`;
    if (!escolhida) return 'Benefício condicionado; sem enquadramento geral para esta NCM.';
    return 'Mesma redução; confira qual anexo descreve melhor o produto.';
  }

  /** Conta da alíquota efetiva, por extenso. */
  function contaAliquota(classif, prem) {
    if (!prem) return '';
    if (prem.cbs === null) return `${prem.ano}: alíquotas oficiais de teste definidas pela calculadora (CBS 0,9% / IBS 0,1%), compensáveis com PIS/COFINS.`;
    const r = (k) => (classif ? classif[k] || 0 : 0);
    const ef = aliquotaEfetiva(classif, prem);
    return `${prem.ano}: CBS ${fmt(prem.cbs)}% × (1 − ${fmt(r('percentualReducaoCbs'))}%) + IBS UF ${fmt(prem.ibs_uf)}% × (1 − ${fmt(r('percentualReducaoIbsUf'))}%) + IBS Mun ${fmt(prem.ibs_mun)}% × (1 − ${fmt(r('percentualReducaoIbsMun'))}%) = ${fmt(Math.round(ef * 10000) / 10000)}%`;
  }

  /**
   * Racional completo de uma descoberta (para tela e Excel).
   * res: { tipo, codigo, descricao, testadas, aceitas:[classif], sugestao, is, erro }
   * premissas: lista de premissas por ano (usa 2027 e 2033).
   */
  function racional(res, premissas) {
    if (res.erro) return { passos: [`${res.tipo} ${res.codigo}: ${res.erro}. Confira o código.`], alternativas: [] };
    const sug = res.sugestao;
    const c = sug.classificacao;
    const pAno = (a) => (premissas || []).find((p) => p.ano === a);
    const passos = [];
    passos.push(`1. Cadastro oficial: ${res.tipo} ${res.codigo} = ${res.descricao || '(sem descrição)'}.`);
    if (res.tipo === 'NCM') {
      passos.push(`2. A calculadora oficial testou esta NCM contra as ${res.testadas} cClassTrib que dependem de anexo de NCM. ` +
        (res.aceitas.length ? `Aceitaram: ${res.aceitas.map((a) => `${a.codigo} (${a.descricao})`).join('; ')}.` : 'Nenhuma aceitou: o produto não está em anexo de redução.'));
    } else {
      passos.push(`2. A calculadora oficial testou esta NBS contra as ${res.testadas} cClassTrib que dependem de anexo de NBS. ` +
        (res.aceitas.length ? `Aceitaram: ${res.aceitas.map((a) => `${a.codigo} (${a.descricao})`).join('; ')}.` : 'Esta NBS não aparece em nenhum anexo: tributação integral.'));
    }
    const motivoEscolha = sug.situacao === 'AUTOMATICA' ? 'é o único tratamento aplicável a qualquer comprador'
      : sug.situacao === 'INTEGRAL' ? 'nenhum anexo de redução abrange este código'
      : c ? 'tem a maior redução entre as opções de aplicação geral; há alternativas abaixo'
      : 'as únicas opções com benefício dependem do comprador/operação; por prudência foi sugerida a tributação integral';
    passos.push(`3. Sugerida ${sug.codigo} (CST ${sug.cst}${c ? ` – ${c.descricaoTratamentoTributario || c.descricao}` : ' – tributação integral'}) porque ${motivoEscolha}. ${sug.observacao}`);
    const f = c && c._fund;
    passos.push(`4. Base legal (LC 214/2025): ${f ? (String(f.texto || '').startsWith(f.textoCurto) ? f.texto : `${f.textoCurto} – ${f.texto}`) : 'regra geral, sem redução.'}`);
    passos.push(`5. Redução: CBS ${fmt(c ? c.percentualReducaoCbs : 0)}% · IBS UF ${fmt(c ? c.percentualReducaoIbsUf : 0)}% · IBS Mun ${fmt(c ? c.percentualReducaoIbsMun : 0)}%.`);
    passos.push(`6. Alíquota efetiva estimada (alíquotas nominais = premissas editáveis do passo 2 da tela): ${[contaAliquota(c, pAno(2027)), contaAliquota(c, pAno(2033))].filter(Boolean).join(' | ')}.`);
    if (c) passos.push(`7. Crédito para o comprador: CBS ${c.indicaApropriacaoCreditoAdquirenteCbs ? 'sim' : 'não'} · IBS ${c.indicaApropriacaoCreditoAdquirenteIbs ? 'sim' : 'não'}.`);
    if (res.is) passos.push(`8. Imposto Seletivo: o cadastro oficial marca este produto como sujeito ao IS (CST ${res.is.cst} / cClassTrib ${res.is.cclasstrib}). ${res.is.aliquota !== null ? `Alíquota ad valorem ${fmt(res.is.aliquota)}%.` : 'A alíquota ainda não está definida na calculadora: informe is_aliquota para simular.'}`);
    const alternativas = sug.alternativas.map((a) => ({
      codigo: a.codigo, cst: a.codigo.slice(0, 3), descricao: a.descricao,
      reducao: a.percentualReducaoCbs || 0,
      efetiva_2033: arred4(aliquotaEfetiva(a, pAno(2033))),
      base_legal: a._fund ? a._fund.textoCurto : '',
      motivo: motivoAlternativa(a, c),
    }));
    if (c && sug.codigo !== '000001') {
      alternativas.push({ codigo: '000001', cst: '000', descricao: 'Tributação integral (sem redução)', reducao: 0,
        efetiva_2033: arred4(aliquotaEfetiva(null, pAno(2033))), base_legal: 'LC 214/2025', motivo: 'Só se o produto não se enquadrar na descrição do anexo.' });
    }
    return { passos, alternativas };
  }

  function descricaoNcm(info) {
    if (!info) return '';
    const partes = [info.posicao, info.subposicao, info.item, info.subitem].filter(Boolean);
    const especifica = partes[partes.length - 1] || info.capitulo || '';
    return partes.length > 1 ? `${partes[0]} › ${especifica}` : especifica;
  }

  // ---------- utilidades ----------
  function normalizarCabecalho(s) {
    return String(s || '').trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function vazio(v) { return v === undefined || v === null || String(v).trim() === ''; }

  function numero(v) {
    if (vazio(v)) return null;
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    let s = String(v).trim().replace(/\s|R\$/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  function codigo(v, tamanho) {
    if (vazio(v)) return '';
    let s = typeof v === 'number' ? String(Math.round(v)) : String(v).trim().replace(/[.\-\s]/g, '');
    if (tamanho && /^\d+$/.test(s) && s.length < tamanho) s = s.padStart(tamanho, '0');
    return s;
  }

  function dataISO(v) {
    if (vazio(v)) return null;
    if (v instanceof Date && !isNaN(v)) return { ano: v.getFullYear(), mes: v.getMonth() + 1, dia: v.getDate() };
    if (typeof v === 'number') { // número serial do Excel
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return { ano: +m[1], mes: +m[2], dia: +m[3] };
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return { ano: +m[3], mes: +m[2], dia: +m[1] };
    return null;
  }

  function dataHoraNoAno(data, ano) {
    let dia = data.dia;
    if (data.mes === 2 && dia === 29 && !(ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0))) dia = 28;
    const p = (n) => String(n).padStart(2, '0');
    return `${ano}-${p(data.mes)}-${p(dia)}T12:00:00-03:00`;
  }

  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // ---------- leitura e validação da planilha ----------
  /**
   * Recebe as linhas cruas (objetos com cabeçalhos já normalizados) e devolve
   * { linhas: [...normalizadas válidas], problemas: [{linha, coluna, mensagem, tipo}] }.
   * tipo "erro" impede o cálculo da linha; "alerta" apenas informa.
   */
  function validarLinhas(cruas, classificacoesConhecidas) {
    const problemas = [];
    const linhas = [];
    const conhecidas = classificacoesConhecidas || null;

    cruas.forEach((bruta, i) => {
      const nLinha = bruta.__linha || i + 2;
      const p = (coluna, mensagem, tipo = 'erro') => problemas.push({ linha: nLinha, coluna, mensagem, tipo });
      const vazia = COLUNAS.every((col) => vazio(bruta[col.c]));
      if (vazia) return;

      const l = { _linha: nLinha };
      l.id_operacao = vazio(bruta.id_operacao) ? '' : String(bruta.id_operacao).trim();
      l.sku = vazio(bruta.sku) ? '' : String(bruta.sku).trim();
      l.descricao = vazio(bruta.descricao) ? '' : String(bruta.descricao).trim();
      l.cliente = vazio(bruta.cliente) ? '(sem cliente)' : String(bruta.cliente).trim();
      l.canal = vazio(bruta.canal) ? '(sem canal)' : String(bruta.canal).trim();
      l.uf = vazio(bruta.uf) ? '' : String(bruta.uf).trim().toUpperCase();
      l.municipio_ibge = codigo(bruta.municipio_ibge);
      l.ncm = codigo(bruta.ncm, 8);
      l.nbs = codigo(bruta.nbs, 9);
      l.cst = codigo(bruta.cst, 3);
      l.cclasstrib = codigo(bruta.cclasstrib, 6);
      l.unidade = vazio(bruta.unidade) ? 'UN' : String(bruta.unidade).trim().toUpperCase();
      l.is_cst = codigo(bruta.is_cst, 3);
      l.is_cclasstrib = codigo(bruta.is_cclasstrib, 6);
      l.data = dataISO(bruta.data_fato_gerador);

      const nums = ['quantidade', 'valor_produto', 'frete', 'seguro', 'outras_despesas', 'desconto', 'base_calculo',
        'receita_bruta', 'custo_total', 'pis', 'cofins', 'icms', 'iss', 'ipi', 'is_aliquota', 'is_base_calculo'];
      let numInvalido = false;
      nums.forEach((c) => {
        const n = numero(bruta[c]);
        if (Number.isNaN(n)) { p(c, `Valor "${bruta[c]}" não é numérico`); numInvalido = true; }
        else if (n !== null && n < 0) { p(c, 'Valor negativo não é permitido'); numInvalido = true; }
        l[c] = n;
      });
      if (l.quantidade === null) l.quantidade = 1;
      ['frete', 'seguro', 'outras_despesas', 'desconto', 'pis', 'cofins', 'icms', 'iss', 'ipi'].forEach((c) => { if (l[c] === null) l[c] = 0; });

      const antes = problemas.filter((x) => x.tipo === 'erro').length;
      if (!l.id_operacao) l.id_operacao = `OP-${nLinha}`;
      if (!l.sku) l.sku = l.ncm || l.nbs || `LINHA-${nLinha}`;
      if (vazio(bruta.data_fato_gerador)) l.data = { ano: 2027, mes: 1, dia: 1 };
      else if (!l.data) p('data_fato_gerador', 'Data inválida (use AAAA-MM-DD)');
      if (!l.uf && !l.municipio_ibge) {
        l.uf = LOCAL_PADRAO.uf; l.municipio_ibge = LOCAL_PADRAO.municipio;
        p('uf', `UF/município vazios: usado ${LOCAL_PADRAO.uf} / ${LOCAL_PADRAO.nome}`, 'alerta');
      }
      if (!UFS.includes(l.uf)) p('uf', `UF "${l.uf}" inválida`);
      if (!/^\d{7}$/.test(l.municipio_ibge)) p('municipio_ibge', 'Código IBGE deve ter 7 dígitos');
      if (!l.ncm && !l.nbs) p('ncm', 'Informe NCM (mercadoria) ou NBS (serviço)');
      if (l.ncm && !/^\d{8}$/.test(l.ncm)) p('ncm', 'NCM deve ter 8 dígitos');
      if (l.nbs && !/^\d{9}$/.test(l.nbs)) p('nbs', 'NBS deve ter 9 dígitos');
      l.origem_cclasstrib = bruta.__origem_cclasstrib || 'informada';
      if (!l.cst && /^\d{6}$/.test(l.cclasstrib)) l.cst = l.cclasstrib.slice(0, 3);
      if (!l.cst && !l.cclasstrib) p('cclasstrib', 'cClassTrib vazia e não foi possível descobrir pela NCM/NBS');
      else if (!/^\d{3}$/.test(l.cst)) p('cst', 'CST deve ter 3 dígitos');
      if (!l.cclasstrib) { /* já reportado */ } else if (!/^\d{6}$/.test(l.cclasstrib)) p('cclasstrib', 'cClassTrib deve ter 6 dígitos');
      else if (l.cst && l.cclasstrib.slice(0, 3) !== l.cst) p('cclasstrib', `cClassTrib ${l.cclasstrib} não pertence ao CST ${l.cst}`);
      else if (conhecidas && !conhecidas.has(l.cclasstrib)) p('cclasstrib', `cClassTrib ${l.cclasstrib} não encontrada na tabela vigente da calculadora`, 'alerta');
      if (l.is_cst || l.is_cclasstrib || l.is_aliquota !== null) {
        if (!/^\d{3}$/.test(l.is_cst)) p('is_cst', 'Imposto Seletivo: CST deve ter 3 dígitos');
        if (!/^\d{6}$/.test(l.is_cclasstrib)) p('is_cclasstrib', 'Imposto Seletivo: cClassTrib deve ter 6 dígitos');
        if (l.is_aliquota === null) {
          p('is_aliquota', 'Produto sujeito ao Imposto Seletivo sem alíquota definida em lei: simulado com IS de 0%. Informe is_aliquota para simular o IS.', 'alerta');
          l.is_aliquota = 0;
        }
      }

      // valores econômicos
      if (l.valor_produto === null && l.base_calculo === null && l.receita_bruta === null) {
        p('valor_produto', 'Informe valor_produto (ou base_calculo / receita_bruta)');
      }
      if (l.valor_produto === null && l.receita_bruta !== null) l.valor_produto = Math.max(l.receita_bruta - l.ipi, 0);
      if (l.valor_produto === null && l.base_calculo !== null) l.valor_produto = l.base_calculo;
      if (l.receita_bruta === null && l.valor_produto !== null) {
        l.receita_bruta = l.valor_produto + l.frete + l.seguro + l.outras_despesas - l.desconto + l.ipi;
      }
      if (l.custo_total === null) p('custo_total', 'Sem custo: margem bruta não será calculada', 'alerta');

      const erros = problemas.filter((x) => x.tipo === 'erro').length - antes;
      if (!erros && !numInvalido) linhas.push(l);
    });

    return { linhas, problemas };
  }

  function lerPremissas(cruas) {
    const porAno = new Map(PREMISSAS_PADRAO.map((p) => [p.ano, { ...p }]));
    cruas.forEach((r) => {
      const ano = numero(r.ano);
      if (!ano || !porAno.has(ano)) return;
      const alvo = porAno.get(ano);
      COLUNAS_PREMISSAS.forEach(([c]) => {
        if (c === 'ano') return;
        const n = numero(r[c]);
        if (n !== null && !Number.isNaN(n)) alvo[c] = n;
      });
      if (ano === 2026) { alvo.cbs = null; alvo.ibs_uf = null; alvo.ibs_mun = null; }
    });
    return [...porAno.values()];
  }

  // ---------- montagem das requisições ----------
  function requisicaoBase(l, ano, prem) {
    return {
      anoFatoGerador: ano,
      tipoDocumento: 55,
      natureza: l.nbs && !l.ncm ? 'servico' : 'bem',
      vProd: r2(l.valor_produto || 0),
      vFrete: r2(l.frete),
      vSeg: r2(l.seguro),
      vOutro: r2(l.outras_despesas),
      vDesc: r2(l.desconto),
      vIS: 0,
      vPIS: r2(l.pis * prem.fator_pis_cofins),
      vCOFINS: r2(l.cofins * prem.fator_pis_cofins),
      vICMS: r2(l.icms * prem.fator_icms_iss),
      vISSQN: r2(l.iss * prem.fator_icms_iss),
    };
  }

  function chaveBase(req) { return JSON.stringify(req); }

  function temIS(l, ano) { return ano >= 2027 && !!l.is_cst; }

  /**
   * Agrupa as linhas em operações para um ano e devolve
   * [{ corpo: OperacaoInput, mapa: [indice da linha para cada item] }].
   * bases: Map(indiceLinha -> {baseRG, baseIS}) com a base oficial derivada (quando aplicável).
   */
  function montarOperacoes(linhas, ano, prem, bases) {
    const grupos = new Map();
    linhas.forEach((l, idx) => {
      const k = `${l.id_operacao}|${l.uf}|${l.municipio_ibge}|${l.data.mes}-${l.data.dia}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(idx);
    });
    const ops = [];
    let seq = 0;
    grupos.forEach((idxs) => {
      for (let i = 0; i < idxs.length; i += LIMITE_ITENS_POR_OPERACAO) {
        const lote = idxs.slice(i, i + LIMITE_ITENS_POR_OPERACAO);
        const primeira = linhas[lote[0]];
        const itens = lote.map((idx, j) => {
          const l = linhas[idx];
          const b = bases.get(idx) || {};
          const item = { numero: j + 1, cst: l.cst, cClassTrib: l.cclasstrib, quantidade: l.quantidade, unidade: l.unidade };
          if (l.ncm) item.ncm = l.ncm;
          if (l.nbs) item.nbs = l.nbs;
          const baseCbsIbs = l.base_calculo !== null ? l.base_calculo : b.baseRG;
          if (temIS(l, ano)) {
            const baseIS = l.is_base_calculo !== null ? l.is_base_calculo : (b.baseIS !== undefined ? b.baseIS : baseCbsIbs);
            item.impostoSeletivo = { cst: l.is_cst, cClassTrib: l.is_cclasstrib, baseCalculo: r2(baseIS), quantidade: l.quantidade, unidade: l.unidade };
            // sem base informada, a calculadora deriva a base de CBS/IBS = base do IS + IS
            if (l.base_calculo !== null) item.baseCalculo = r2(l.base_calculo);
          } else {
            item.baseCalculo = r2(baseCbsIbs || 0);
          }
          if (ano >= 2027) {
            item.aliquotasNominais = { cbs: prem.cbs, ibsEstadual: prem.ibs_uf, ibsMunicipal: prem.ibs_mun };
            if (temIS(l, ano)) item.aliquotasNominais.impostoSeletivo = { adValorem: l.is_aliquota };
          }
          return item;
        });
        seq += 1;
        ops.push({
          corpo: {
            id: `sim-${ano}-${seq}`,
            versao: '1.0.0',
            dhFatoGerador: dataHoraNoAno(primeira.data, ano),
            municipio: Number(primeira.municipio_ibge),
            uf: primeira.uf,
            itens,
          },
          mapa: lote,
        });
      }
    });
    return ops;
  }

  // ---------- leitura da resposta ----------
  function n(v) { const x = parseFloat(v); return isFinite(x) ? x : 0; }

  function lerObjeto(obj) {
    const r = { estado: obj.estadoItem, erros: obj.erros || [], vBC: 0, vCBS: 0, vIBSUF: 0, vIBSMun: 0, vIS: 0, pRedCBS: 0, pAliqEfetCBS: null };
    const t = obj.tribCalc || {};
    const g = t.IBSCBS && t.IBSCBS.gIBSCBS;
    if (g) {
      r.vBC = n(g.vBC);
      if (g.gCBS) {
        r.vCBS = n(g.gCBS.vCBS);
        if (g.gCBS.gRed) { r.pRedCBS = n(g.gCBS.gRed.pRedAliq); r.pAliqEfetCBS = n(g.gCBS.gRed.pAliqEfet); }
      }
      if (g.gIBSUF) r.vIBSUF = n(g.gIBSUF.vIBSUF);
      if (g.gIBSMun) r.vIBSMun = n(g.gIBSMun.vIBSMun);
    }
    if (t.IS) r.vIS = n(t.IS.vIS);
    return r;
  }

  // ---------- conta gerencial ----------
  /**
   * Premissa: preço praticado hoje (receita bruta) é mantido.
   * carga_atual = PIS + COFINS + ICMS + ISS + IPI
   * carga_nova  = tributos antigos remanescentes (fatores do ano) + (CBS + IBS + IS) se considerados
   * receita líquida = receita bruta - carga; margem = receita líquida - custo
   * reajuste p/ manter receita líquida = RL_atual / (1 - carga_nova/RB) / RB - 1
   */
  function metricas(l, res, prem) {
    const rb = l.receita_bruta || 0;
    const cargaAtual = l.pis + l.cofins + l.icms + l.iss + l.ipi;
    const legado = (l.pis + l.cofins) * prem.fator_pis_cofins + (l.icms + l.iss) * prem.fator_icms_iss + l.ipi * prem.fator_ipi;
    const calculado = res && (res.estado === 'CALCULADO' || res.estado === 'CALCULO_SIMULADO');
    const cbs = calculado ? res.vCBS : 0;
    const ibs = calculado ? res.vIBSUF + res.vIBSMun : 0;
    const is = calculado ? res.vIS : 0;
    const novos = (cbs + ibs + is) * (prem.considerar_cbs_ibs ? 1 : 0);
    const cargaNova = legado + novos;
    const rlAtual = rb - cargaAtual;
    const rlNova = rb - cargaNova;
    const custo = l.custo_total;
    const tNova = rb ? cargaNova / rb : 0;
    const precoEq = tNova < 1 ? rlAtual / (1 - tNova) : null;
    return {
      calculado,
      receita_bruta: rb,
      carga_atual: cargaAtual,
      legado,
      cbs, ibs, is,
      novos,
      carga_nova: cargaNova,
      variacao_carga: cargaNova - cargaAtual,
      rl_atual: rlAtual,
      rl_nova: rlNova,
      margem_atual: custo === null ? null : rlAtual - custo,
      margem_nova: custo === null ? null : rlNova - custo,
      custo,
      preco_equilibrio: precoEq,
      reajuste_pct: precoEq !== null && rb ? (precoEq / rb - 1) * 100 : null,
    };
  }

  function somar(lista) {
    const s = { receita_bruta: 0, carga_atual: 0, legado: 0, cbs: 0, ibs: 0, is: 0, novos: 0, carga_nova: 0, rl_atual: 0, rl_nova: 0, custo: 0, margem_atual: 0, margem_nova: 0, itens: 0, com_custo: 0, preco_equilibrio: 0 };
    lista.forEach((m) => {
      ['receita_bruta', 'carga_atual', 'legado', 'cbs', 'ibs', 'is', 'novos', 'carga_nova', 'rl_atual', 'rl_nova'].forEach((k) => { s[k] += m[k]; });
      if (m.custo !== null) { s.custo += m.custo; s.margem_atual += m.margem_atual; s.margem_nova += m.margem_nova; s.com_custo += 1; }
      if (m.preco_equilibrio !== null) s.preco_equilibrio += m.preco_equilibrio;
      s.itens += 1;
    });
    s.variacao_carga = s.carga_nova - s.carga_atual;
    s.pct_atual = s.receita_bruta ? (s.carga_atual / s.receita_bruta) * 100 : 0;
    s.pct_nova = s.receita_bruta ? (s.carga_nova / s.receita_bruta) * 100 : 0;
    s.reajuste_pct = s.receita_bruta ? (s.preco_equilibrio / s.receita_bruta - 1) * 100 : 0;
    s.mb_atual_pct = s.com_custo && s.rl_atual ? (s.margem_atual / s.rl_atual) * 100 : null;
    s.mb_nova_pct = s.com_custo && s.rl_nova ? (s.margem_nova / s.rl_nova) * 100 : null;
    return s;
  }

  const API = {
    ANOS, UFS, PREMISSAS_PADRAO, COLUNAS_PREMISSAS, COLUNAS, EXEMPLOS, LIMITE_ITENS_POR_OPERACAO,
    normalizarCabecalho, numero, codigo, LOCAL_PADRAO, sugerirClassificacao, aliquotaEfetiva, descricaoNcm, racional, contaAliquota, dataISO, dataHoraNoAno, validarLinhas, lerPremissas,
    requisicaoBase, chaveBase, temIS, montarOperacoes, lerObjeto, metricas, somar, r2,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.Regras = API;
})(typeof window !== 'undefined' ? window : globalThis);
