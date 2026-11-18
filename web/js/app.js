/* Tela do simulador: upload, chamadas à calculadora oficial, resultados e exportação. */
(function () {
  'use strict';
  const R = window.Regras;
  const API = '/api/calculadora';
  const CONCORRENCIA = 6;

  const estado = {
    premissas: R.PREMISSAS_PADRAO.map((p) => ({ ...p })),
    linhas: [],
    problemas: [],
    arquivo: '',
    versao: null,
    pacote: null,
    classificacoes: new Map(),
    resultados: new Map(), // ano -> array (por linha) de resultado da API
    anos: [],
    descobertas: [], // resultados da descoberta pela NCM/NBS (cartão e planilha)
  };
  const DATA_DESCOBERTA = '2027-01-01';

  const $ = (id) => document.getElementById(id);
  const fmtR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const fmtR2 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtN = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const fmtP = (v) => (v === null || v === undefined || !isFinite(v) ? '–' : `${fmtN.format(v)}%`);
  const fmtPP = (v) => (!isFinite(v) ? '–' : `${v > 0 ? '+' : ''}${fmtN.format(v)} p.p.`);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hoje = () => new Date().toISOString().slice(0, 10);

  // ---------------- rede ----------------
  async function requisitar(metodo, caminho, corpo, tentativas = 3) {
    let ultimoErro;
    for (let t = 0; t < tentativas; t++) {
      try {
        const resp = await fetch(API + caminho, {
          method: metodo,
          headers: corpo ? { 'Content-Type': 'application/json' } : {},
          body: corpo ? JSON.stringify(corpo) : undefined,
        });
        const texto = await resp.text();
        let dados = null;
        try { dados = texto ? JSON.parse(texto) : null; } catch (e) { dados = { detail: texto }; }
        if (resp.status >= 500 && t < tentativas - 1) { ultimoErro = dados; continue; }
        return { ok: resp.ok, status: resp.status, dados };
      } catch (e) {
        ultimoErro = e;
        await new Promise((r) => setTimeout(r, 400 * (t + 1)));
      }
    }
    return { ok: false, status: 0, dados: { detail: String(ultimoErro && ultimoErro.message ? ultimoErro.message : ultimoErro) } };
  }

  async function emParalelo(tarefas, limite, aoConcluir) {
    let i = 0;
    const trabalhador = async () => {
      while (i < tarefas.length) {
        const atual = i++;
        await tarefas[atual]();
        aoConcluir();
      }
    };
    await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, trabalhador));
  }

  // ---------------- inicialização ----------------
  async function iniciar() {
    renderPremissas();
    renderAnos();
    ligarEventos();
    try {
      const r = await fetch('versao.json', { cache: 'no-store' });
      if (r.ok) {
        estado.pacote = await r.json();
        $('versao-pacote').textContent = ` Pacote ${estado.pacote.pacote || ''}.`;
      }
    } catch (e) { /* execução fora do pacote */ }
    const v = await requisitar('GET', '/dados-abertos/versao');
    if (v.ok) {
      estado.versao = v.dados;
      $('status-ponto').className = 'ponto ok';
      $('status-texto').innerHTML = `Calculadora oficial <b>v${esc(v.dados.versaoApp)}</b> · tabelas ${esc(v.dados.versaoDb)} de ${esc(formatarData(v.dados.dataVersaoDb))}`;
    } else {
      $('status-ponto').className = 'ponto falha';
      $('status-texto').textContent = 'Calculadora não respondeu. Feche e abra o simulador novamente.';
    }
    estado.carregandoTabelas = carregarClassificacoes();
    await estado.carregandoTabelas;
  }

  function formatarData(iso) {
    if (!iso) return '';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }

  async function carregarClassificacoes() {
    const datas = [hoje(), '2027-01-01'];
    for (const d of datas) {
      const r = await requisitar('GET', `/dados-abertos/classificacoes-tributarias/cbs-ibs?data=${d}`);
      if (r.ok && Array.isArray(r.dados)) r.dados.forEach((c) => { if (!estado.classificacoes.has(c.codigo)) estado.classificacoes.set(c.codigo, c); });
    }
  }

  // ---------------- premissas ----------------
  function renderPremissas() {
    const t = $('tab-premissas');
    let h = '<thead><tr>' + R.COLUNAS_PREMISSAS.map(([, rot]) => `<th class="num">${esc(rot)}</th>`).join('') + '</tr></thead><tbody>';
    estado.premissas.forEach((p, i) => {
      h += '<tr>' + R.COLUNAS_PREMISSAS.map(([c]) => {
        if (c === 'ano') return `<td class="num"><b>${p.ano}</b></td>`;
        if (p.ano === 2026 && ['cbs', 'ibs_uf', 'ibs_mun'].includes(c)) return '<td class="num nota">oficial</td>';
        return `<td class="num"><input type="number" step="0.01" min="0" data-i="${i}" data-c="${c}" value="${p[c] ?? ''}" aria-label="${c} ${p.ano}"></td>`;
      }).join('') + '</tr>';
    });
    t.innerHTML = h + '</tbody>';
  }

  function renderAnos() {
    $('anos').innerHTML = R.ANOS.map((a) => `<label><input type="checkbox" value="${a}" ${[2026, 2027, 2029, 2033].includes(a) ? 'checked' : ''}> ${a}</label>`).join('');
  }

  // ---------------- eventos ----------------
  function ligarEventos() {
    $('btn-modelo').addEventListener('click', baixarModelo);
    $('btn-premissas-padrao').addEventListener('click', () => {
      estado.premissas = R.PREMISSAS_PADRAO.map((p) => ({ ...p }));
      renderPremissas();
    });
    $('tab-premissas').addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset.c) return;
      const n = R.numero(el.value);
      estado.premissas[+el.dataset.i][el.dataset.c] = n === null || Number.isNaN(n) ? 0 : n;
    });
    $('arquivo').addEventListener('change', (e) => e.target.files[0] && lerArquivo(e.target.files[0]));
    const zona = $('soltar');
    ['dragenter', 'dragover'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('ativo'); }));
    ['dragleave', 'drop'].forEach((ev) => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('ativo'); }));
    zona.addEventListener('drop', (e) => e.dataTransfer.files[0] && lerArquivo(e.dataTransfer.files[0]));
    $('btn-calcular').addEventListener('click', calcular);
    $('sel-ano').addEventListener('change', renderResultados);
    $('sel-dim').addEventListener('change', renderTabelaDimensao);
    $('btn-exportar').addEventListener('click', exportar);
    $('btn-descobrir').addEventListener('click', () => descobrirCodigos(lerCodigosColados($('desc-codigos').value)));
    $('desc-arquivo').addEventListener('change', (e) => e.target.files[0] && descobrirDaPlanilha(e.target.files[0]));
    $('btn-desc-exportar').addEventListener('click', exportarDescobertas);
  }

  // ---------------- planilha-modelo ----------------
  async function garantirClassificacoes() {
    if (estado.carregandoTabelas) await estado.carregandoTabelas;
    if (!estado.classificacoes.size) {
      estado.carregandoTabelas = carregarClassificacoes();
      await estado.carregandoTabelas;
    }
  }

  async function baixarModelo() {
    const btn = $('btn-modelo');
    btn.disabled = true;
    await garantirClassificacoes();
    btn.disabled = false;
    if (!estado.classificacoes.size) alert('Não foi possível carregar a tabela de cClassTrib da calculadora. A planilha será gerada sem a aba Tabelas preenchida.');
    const wb = montarModelo(R.EXEMPLOS);
    const v = estado.versao ? `_calc-v${estado.versao.versaoApp}` : '';
    XLSX.writeFile(wb, `modelo_simulador_rtc${v}.xlsx`);
  }

  function montarModelo(itensExemplo) {
    const wb = XLSX.utils.book_new();

    const instr = [
      ['SIMULADOR DA REFORMA TRIBUTÁRIA (CBS / IBS / IS) — INSTRUÇÕES'],
      [''],
      ['1. Preencha a aba "Itens": uma linha por item vendido (pode ser o item de nota, ou o faturamento agregado por SKU/UF/mês).'],
      ['2. Mantenha os nomes das colunas da linha 1. Colunas extras são ignoradas. Não é necessário preencher as colunas opcionais.'],
      ['3. A aba "Premissas" traz as alíquotas e os fatores de transição por ano. Ajuste se quiser outro cenário.'],
      ['4. A aba "Tabelas" lista as classificações tributárias (cClassTrib) vigentes na versão atual da calculadora.'],
      ['5. Salve e envie o arquivo no simulador.'],
      [''],
      ['COMO O SIMULADOR CALCULA'],
      ['• CBS, IBS e Imposto Seletivo são calculados pela calculadora oficial da Receita Federal (bases, reduções e alíquotas efetivas).'],
      ['• A base de cálculo de cada ano é derivada pela calculadora a partir de valor_produto, frete, seguro, outras despesas, desconto e dos tributos antigos que ainda existem no ano.'],
      ['• Carga atual = PIS + COFINS + ICMS + ISS + IPI informados.'],
      ['• Carga nova (ano) = tributos antigos remanescentes (fatores da aba Premissas) + CBS + IBS + IS.'],
      ['• Premissa: o preço cobrado hoje (receita bruta) é mantido. Receita líquida = receita bruta − carga. Margem bruta = receita líquida − custo.'],
      ['• Reajuste necessário = variação de preço que mantém a receita líquida atual com a carga nova.'],
      ['• Em 2026 a CBS (0,9%) e o IBS (0,1%) são de teste e compensáveis com PIS/COFINS, por isso não entram como custo.'],
      ['• Simulação gerencial de primeira ordem: não considera créditos nas compras nem efeitos de "por fora" sobre o preço final.'],
      [''],
      ['COLUNA', 'OBRIGATÓRIA', 'DESCRIÇÃO', 'EXEMPLO'],
      ...R.COLUNAS.map((c) => [c.c, { S: 'Sim', C: 'Condicional', N: 'Não' }[c.obrig], c.d, c.ex]),
      [''],
      ['PREMISSAS (aba Premissas)'],
      ['cbs, ibs_uf, ibs_mun', '', 'Alíquotas nominais (%) informadas à calculadora a partir de 2027. Em 2026 a calculadora usa as oficiais.'],
      ['fator_pis_cofins', '', 'Fração do PIS/COFINS atual que ainda existe no ano (0 a partir de 2027).'],
      ['fator_icms_iss', '', 'Fração do ICMS/ISS atual que ainda existe no ano (1 até 2028; 0,9/0,8/0,7/0,6 de 2029 a 2032; 0 em 2033).'],
      ['fator_ipi', '', 'Fração do IPI atual que ainda existe (0 a partir de 2027, exceto produtos da Zona Franca de Manaus).'],
      ['considerar_cbs_ibs', '', '1 = CBS/IBS/IS entram como custo no ano; 0 = não entram (2026, ano de teste).'],
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr);
    wsI['!cols'] = [{ wch: 24 }, { wch: 13 }, { wch: 110 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsI, 'Instrucoes');

    const cab = R.COLUNAS.map((c) => c.c);
    const linhas = itensExemplo.map((ex) => cab.map((c) => (ex[c] === undefined || ex[c] === null ? '' : ex[c])));
    const wsItens = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
    wsItens['!cols'] = cab.map((c) => ({ wch: Math.max(c.length + 2, ['descricao'].includes(c) ? 40 : 12) }));
    XLSX.utils.book_append_sheet(wb, wsItens, 'Itens');

    const prem = [R.COLUNAS_PREMISSAS.map(([c]) => c), ...estado.premissas.map((p) => R.COLUNAS_PREMISSAS.map(([c]) => (p.ano === 2026 && ['cbs', 'ibs_uf', 'ibs_mun'].includes(c) ? 'oficial' : p[c])))];
    const wsP = XLSX.utils.aoa_to_sheet(prem);
    wsP['!cols'] = R.COLUNAS_PREMISSAS.map(() => ({ wch: 18 }));
    XLSX.utils.book_append_sheet(wb, wsP, 'Premissas');

    const tab = [['cclasstrib', 'cst', 'descricao', 'tratamento', 'tipo_aliquota', 'reducao_cbs_%', 'reducao_ibs_uf_%', 'reducao_ibs_mun_%', 'credito_adquirente_cbs', 'credito_adquirente_ibs', 'nomenclatura']];
    [...estado.classificacoes.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)).forEach((c) => {
      tab.push([c.codigo, c.codigo.slice(0, 3), c.descricao, c.descricaoTratamentoTributario, c.tipoAliquota, c.percentualReducaoCbs, c.percentualReducaoIbsUf, c.percentualReducaoIbsMun,
        c.indicaApropriacaoCreditoAdquirenteCbs ? 'Sim' : 'Não', c.indicaApropriacaoCreditoAdquirenteIbs ? 'Sim' : 'Não', c.nomenclatura]);
    });
    const wsT = XLSX.utils.aoa_to_sheet(tab);
    wsT['!cols'] = [{ wch: 11 }, { wch: 6 }, { wch: 80 }, { wch: 30 }, { wch: 14 }, { wch: 13 }, { wch: 15 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsT, 'Tabelas');

    return wb;
  }

  // ---------------- leitura da planilha ----------------
  function linhasDaAba(ws) {
    const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: '', raw: true });
    if (!matriz.length) return [];
    const cab = matriz[0].map(R.normalizarCabecalho);
    return matriz.slice(1).map((arr, i) => {
      const o = { __linha: i + 2 };
      cab.forEach((c, j) => { if (c) o[c] = arr[j]; });
      return o;
    });
  }

  async function lerArquivo(arquivo) {
    estado.arquivo = arquivo.name;
    await garantirClassificacoes();
    $('soltar-texto').textContent = `Lendo ${arquivo.name}…`;
    try {
      const buf = await arquivo.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const nomes = wb.SheetNames;
      const nomeItens = nomes.find((n) => R.normalizarCabecalho(n) === 'itens') || nomes.find((n) => !['instrucoes', 'premissas', 'tabelas'].includes(R.normalizarCabecalho(n)));
      const nomePrem = nomes.find((n) => R.normalizarCabecalho(n) === 'premissas');
      if (nomePrem) {
        estado.premissas = R.lerPremissas(linhasDaAba(wb.Sheets[nomePrem]));
        renderPremissas();
      }
      const cruas = linhasDaAba(wb.Sheets[nomeItens]);
      await completarPelaNcm(cruas);
      const { linhas, problemas } = R.validarLinhas(cruas, estado.classificacoes.size ? estado.classificacoes : null);
      estado.linhas = linhas;
      estado.problemas = problemas;
      estado.resultados = new Map();
      $('resultados').hidden = true;
      $('soltar-texto').textContent = `${arquivo.name} — clique para trocar`;
      renderValidacao(nomePrem);
    } catch (e) {
      $('validacao').innerHTML = `<div class="aviso erro">Não foi possível ler o arquivo: ${esc(e.message)}</div>`;
      $('soltar-texto').textContent = 'Clique ou arraste a planilha aqui (.xlsx)';
    }
  }

  function renderValidacao(temPremissas) {
    const erros = estado.problemas.filter((p) => p.tipo === 'erro');
    const alertas = estado.problemas.filter((p) => p.tipo === 'alerta');
    const linhasErro = new Set(erros.map((p) => p.linha)).size;
    let h = '';
    if (estado.linhas.length) {
      h += `<div class="aviso ok"><b>${estado.linhas.length}</b> linha(s) prontas para cálculo.${temPremissas ? ' Premissas lidas da aba "Premissas".' : ''}</div>`;
    }
    if (linhasErro) h += `<div class="aviso erro"><b>${linhasErro}</b> linha(s) com erro serão ignoradas. Corrija e envie de novo, ou calcule só as válidas.</div>`;
    if (alertas.length) h += `<div class="aviso alerta"><b>${alertas.length}</b> alerta(s): não impedem o cálculo.</div>`;
    const desc = estado.linhas.filter((l) => String(l.origem_cclasstrib).startsWith('descoberta'));
    if (desc.length) {
      const rev = desc.filter((l) => l.origem_cclasstrib.includes('revisar')).length;
      h += `<div class="aviso ${rev ? 'alerta' : 'ok'}"><b>${desc.length}</b> linha(s) tiveram a cClassTrib descoberta pela NCM/NBS${rev ? `, <b>${rev}</b> com mais de uma possibilidade` : ''}. O racional de cada código está no cartão "Só tem a NCM?" acima.</div>`;
    }
    if (estado.problemas.length) {
      const lista = estado.problemas.slice(0, 300);
      h += '<div class="tabela-rolagem alta"><table class="tabela"><thead><tr><th class="num">Linha</th><th>Coluna</th><th>Tipo</th><th>Mensagem</th></tr></thead><tbody>' +
        lista.map((p) => `<tr><td class="num">${p.linha}</td><td>${esc(p.coluna)}</td><td>${p.tipo === 'erro' ? '<span class="neg">Erro</span>' : 'Alerta'}</td><td>${esc(p.mensagem)}</td></tr>`).join('') +
        '</tbody></table></div>';
      if (estado.problemas.length > 300) h += `<p class="nota">Mostrando 300 de ${estado.problemas.length}. A lista completa vai no Excel exportado.</p>`;
    }
    if (!estado.linhas.length && !estado.problemas.length) h = '<div class="aviso alerta">Nenhuma linha preenchida encontrada na aba "Itens".</div>';
    $('validacao').innerHTML = h;
    $('area-calculo').hidden = !estado.linhas.length;
  }

  // ---------------- cálculo ----------------
  async function calcular() {
    const anos = [...document.querySelectorAll('#anos input:checked')].map((i) => +i.value).sort();
    if (!anos.length) { alert('Selecione pelo menos um ano.'); return; }
    const btn = $('btn-calcular');
    btn.disabled = true;
    $('progresso').hidden = false;
    const linhas = estado.linhas;
    const premPorAno = new Map(estado.premissas.map((p) => [p.ano, p]));
    estado.resultados = new Map();

    // 1) bases oficiais (quando a base não foi informada)
    const cacheBase = new Map();
    const tarefasBase = [];
    const basesPorAno = new Map();
    anos.forEach((ano) => {
      const prem = premPorAno.get(ano);
      const bases = new Map();
      basesPorAno.set(ano, bases);
      linhas.forEach((l, idx) => {
        const precisa = l.base_calculo === null || (R.temIS(l, ano) && l.is_base_calculo === null);
        if (!precisa) return;
        const req = R.requisicaoBase(l, ano, prem);
        const k = R.chaveBase(req);
        if (!cacheBase.has(k)) {
          cacheBase.set(k, null);
          tarefasBase.push(async () => {
            const r = await requisitar('POST', '/base-calculo/base-calculo-unificada', req);
            cacheBase.set(k, r.ok ? { baseRG: R.numero(r.dados.baseRG), baseIS: R.numero(r.dados.baseIS) } : { erro: (r.dados && (r.dados.detail || r.dados.title)) || `HTTP ${r.status}` });
          });
        }
        bases.set(idx, k);
      });
    });

    // 2) operações
    let feitos = 0;
    let total = tarefasBase.length + 1;
    const progresso = (rotulo) => {
      const pct = Math.min(100, Math.round((feitos / total) * 100));
      $('barra').style.width = `${pct}%`;
      $('progresso-texto').textContent = `${rotulo} ${pct}%`;
    };
    progresso('Calculando bases…');
    await emParalelo(tarefasBase, CONCORRENCIA, () => { feitos++; progresso('Calculando bases…'); });

    const tarefasOp = [];
    anos.forEach((ano) => {
      const prem = premPorAno.get(ano);
      const res = new Array(linhas.length).fill(null);
      estado.resultados.set(ano, res);
      const bases = new Map();
      const ignorar = new Set();
      basesPorAno.get(ano).forEach((k, idx) => {
        const b = cacheBase.get(k);
        if (b && b.erro) {
          ignorar.add(idx);
          res[idx] = { estado: 'FALHA_BASE', erros: [{ code: 'BASE', title: 'Base de cálculo', detail: b.erro }], vBC: 0, vCBS: 0, vIBSUF: 0, vIBSMun: 0, vIS: 0 };
        } else if (b) bases.set(idx, b);
      });
      const subconjunto = linhas.map((l, idx) => (ignorar.has(idx) ? null : l));
      const ops = R.montarOperacoes(linhas.filter((_, idx) => !ignorar.has(idx)), ano, prem, remapear(bases, subconjunto));
      const indicesValidos = subconjunto.map((l, idx) => (l ? idx : -1)).filter((x) => x >= 0);
      ops.forEach((op) => {
        tarefasOp.push(async () => {
          const r = await requisitar('POST', '/observabilidade/regime-geral', op.corpo);
          op.mapa.forEach((posSub, j) => {
            const idx = indicesValidos[posSub];
            if (r.ok && r.dados && Array.isArray(r.dados.objetos)) {
              const obj = r.dados.objetos.find((o) => o.nObj === j + 1);
              res[idx] = obj ? R.lerObjeto(obj) : { estado: 'SEM_RETORNO', erros: [], vBC: 0, vCBS: 0, vIBSUF: 0, vIBSMun: 0, vIS: 0 };
            } else {
              const d = r.dados || {};
              res[idx] = { estado: 'FALHA_TECNICA', erros: [{ code: `HTTP ${r.status}`, title: d.title || 'Falha na calculadora', detail: d.detail || '' }], vBC: 0, vCBS: 0, vIBSUF: 0, vIBSMun: 0, vIS: 0 };
            }
          });
        });
      });
    });
    total = feitos + tarefasOp.length;
    await emParalelo(tarefasOp, CONCORRENCIA, () => { feitos++; progresso('Calculando tributos…'); });

    estado.anos = anos;
    progresso('Concluído');
    btn.disabled = false;
    $('sel-ano').innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join('');
    $('sel-ano').value = String(anos[anos.length - 1]);
    $('resultados').hidden = false;
    renderResultados();
    renderGraficoAnos();
    $('resultados').scrollIntoView({ behavior: 'smooth' });
  }

  // índices das bases precisam seguir o subconjunto de linhas válidas enviado a montarOperacoes
  function remapear(bases, subconjunto) {
    const m = new Map();
    let pos = 0;
    subconjunto.forEach((l, idx) => {
      if (!l) return;
      if (bases.has(idx)) m.set(pos, bases.get(idx));
      pos++;
    });
    return m;
  }

  // ---------------- resultados ----------------
  function metricasDoAno(ano) {
    const prem = estado.premissas.find((p) => p.ano === ano);
    const res = estado.resultados.get(ano) || [];
    return estado.linhas.map((l, idx) => ({ l, r: res[idx], m: R.metricas(l, res[idx], prem) }));
  }

  function renderResultados() {
    const ano = +$('sel-ano').value;
    const dados = metricasDoAno(ano);
    const ok = dados.filter((d) => d.m.calculado);
    const s = R.somar(ok.map((d) => d.m));
    const comErro = dados.length - ok.length;
    const dpp = s.pct_nova - s.pct_atual;
    const kpi = (rotulo, valor, detalhe, classe = '') => `<div class="kpi"><div class="rotulo">${rotulo}</div><div class="valor ${classe}">${valor}</div><div class="detalhe">${detalhe}</div></div>`;
    $('kpis').innerHTML = [
      kpi('Receita bruta', fmtR.format(s.receita_bruta), `${ok.length} itens calculados${comErro ? ` · ${comErro} com inconsistência` : ''}`),
      kpi('Carga atual', fmtP(s.pct_atual), fmtR.format(s.carga_atual)),
      kpi(`Carga ${ano}`, fmtP(s.pct_nova), `${fmtR.format(s.carga_nova)} · CBS ${fmtR.format(s.cbs)} · IBS ${fmtR.format(s.ibs)}${s.is ? ` · IS ${fmtR.format(s.is)}` : ''}`),
      kpi('Variação da carga', fmtPP(dpp), `${s.variacao_carga >= 0 ? '+' : ''}${fmtR.format(s.variacao_carga)} de tributos (efeito inverso na receita líquida)`, dpp > 0 ? 'neg' : 'pos'),
      kpi(`Margem bruta ${ano}`, s.mb_nova_pct === null ? '–' : fmtP(s.mb_nova_pct), s.mb_atual_pct === null ? 'informe custo_total' : `hoje ${fmtP(s.mb_atual_pct)} (sobre receita líquida)`),
      kpi('Reajuste p/ manter receita líquida', `${s.reajuste_pct > 0 ? '+' : ''}${fmtP(s.reajuste_pct)}`, 'no preço ao cliente'),
    ].join('');
    const prem = estado.premissas.find((p) => p.ano === ano);
    $('nota-premissa').textContent = ano === 2026
      ? '2026: CBS/IBS de teste com alíquotas oficiais da calculadora, compensáveis com PIS/COFINS (não entram como custo).'
      : `${ano}: CBS ${fmtN.format(prem.cbs)}% · IBS UF ${fmtN.format(prem.ibs_uf)}% · IBS Mun ${fmtN.format(prem.ibs_mun)}% (estimativas) · ICMS/ISS remanescente ${fmtN.format(prem.fator_icms_iss * 100)}% · cálculos "simulados" pela calculadora oficial.`;
    renderTabelaDimensao();
    renderErros(dados);
  }

  function rotuloDimensao(dim, l) {
    if (dim === 'sku') return l.descricao ? `${l.sku} — ${l.descricao}` : l.sku;
    if (dim === 'cclasstrib') {
      const c = estado.classificacoes.get(l.cclasstrib);
      return c ? `${l.cclasstrib} — ${c.descricaoTratamentoTributario || c.descricao}` : l.cclasstrib;
    }
    return l[dim];
  }

  function agrupar(dados, dim) {
    const g = new Map();
    dados.filter((d) => d.m.calculado).forEach((d) => {
      const k = rotuloDimensao(dim, d.l);
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(d.m);
    });
    return [...g.entries()].map(([k, ms]) => ({ chave: k, s: R.somar(ms) })).sort((a, b) => Math.abs(b.s.variacao_carga) - Math.abs(a.s.variacao_carga));
  }

  function renderTabelaDimensao() {
    const ano = +$('sel-ano').value;
    const dim = $('sel-dim').value;
    const linhas = agrupar(metricasDoAno(ano), dim);
    const cab = ['', 'Itens', 'Receita bruta', 'Carga atual', `Carga ${ano}`, 'Δ p.p.', 'Δ carga R$', 'CBS', 'IBS', 'IS', 'Trib. antigos', 'Margem atual', 'Margem nova', 'Reajuste'];
    let h = '<thead><tr>' + cab.map((c, i) => `<th class="${i ? 'num' : ''}">${c || $('sel-dim').selectedOptions[0].text}</th>`).join('') + '</tr></thead><tbody>';
    linhas.forEach(({ chave, s }) => {
      const dpp = s.pct_nova - s.pct_atual;
      h += `<tr><td>${esc(chave)}</td><td class="num">${s.itens}</td><td class="num">${fmtR.format(s.receita_bruta)}</td>` +
        `<td class="num">${fmtP(s.pct_atual)}</td><td class="num">${fmtP(s.pct_nova)}</td>` +
        `<td class="num ${dpp > 0 ? 'neg' : 'pos'}">${fmtPP(dpp)}</td><td class="num">${fmtR.format(s.variacao_carga)}</td>` +
        `<td class="num">${fmtR.format(s.cbs)}</td><td class="num">${fmtR.format(s.ibs)}</td><td class="num">${fmtR.format(s.is)}</td><td class="num">${fmtR.format(s.legado)}</td>` +
        `<td class="num">${fmtP(s.mb_atual_pct)}</td><td class="num">${fmtP(s.mb_nova_pct)}</td><td class="num">${fmtP(s.reajuste_pct)}</td></tr>`;
    });
    if (!linhas.length) h += `<tr><td colspan="${cab.length}">Nenhum item calculado neste ano.</td></tr>`;
    $('tab-dim').innerHTML = h + '</tbody>';
  }

  function campoDoErro(e) {
    return e.pointer ? String(e.pointer).split('/').slice(3).join('.') || e.pointer : '';
  }

  function listaErros(dados) {
    const out = [];
    dados.forEach(({ l, r }) => {
      if (!r || r.estado === 'CALCULADO' || r.estado === 'CALCULO_SIMULADO') return;
      const erros = r.erros && r.erros.length ? r.erros : [{ code: '', title: r.estado, detail: '' }];
      erros.forEach((e) => out.push({ linha: l._linha, operacao: l.id_operacao, sku: l.sku, estado: r ? r.estado : 'SEM_RETORNO', codigo: e.code || '', campo: campoDoErro(e), mensagem: [e.title, e.detail].filter(Boolean).join(': ') }));
    });
    return out;
  }

  function renderErros(dados) {
    const erros = listaErros(dados);
    let h = '<thead><tr><th class="num">Linha</th><th>Operação</th><th>SKU</th><th>Situação</th><th>Código</th><th>Campo</th><th>Mensagem da calculadora</th></tr></thead><tbody>';
    erros.forEach((e) => {
      h += `<tr><td class="num">${e.linha}</td><td>${esc(e.operacao)}</td><td>${esc(e.sku)}</td><td>${esc(e.estado)}</td><td>${esc(e.codigo)}</td><td>${esc(e.campo)}</td><td>${esc(e.mensagem)}</td></tr>`;
    });
    if (!erros.length) h += '<tr><td colspan="7">Nenhuma inconsistência neste ano.</td></tr>';
    $('tab-erros').innerHTML = h + '</tbody>';
  }

  // ---------------- gráfico ----------------
  let grafico;
  function corVar(nome) { return getComputedStyle(document.documentElement).getPropertyValue(nome).trim(); }
  function renderGraficoAnos() {
    const escuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const paleta = escuro
      ? { cbs: '#3987e5', ibs: '#d95926', is: '#199e70', legado: '#c98500' }
      : { cbs: '#2a78d6', ibs: '#eb6834', is: '#1baf7a', legado: '#eda100' };
    const superficie = corVar('--cartao');
    const texto = corVar('--texto-suave');
    const grade = corVar('--borda');
    const resumo = estado.anos.map((ano) => R.somar(metricasDoAno(ano).filter((d) => d.m.calculado).map((d) => d.m)));
    const pct = (k) => resumo.map((s) => (s.receita_bruta ? (s[k] / s.receita_bruta) * 100 : 0));
    const novos = (k) => resumo.map((s, i) => {
      const prem = estado.premissas.find((p) => p.ano === estado.anos[i]);
      return s.receita_bruta && prem.considerar_cbs_ibs ? (s[k] / s.receita_bruta) * 100 : 0;
    });
    const barra = (rotulo, dados, cor) => ({ type: 'bar', label: rotulo, data: dados, backgroundColor: cor, borderColor: superficie, borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'bottom', stack: 'nova', maxBarThickness: 48 });
    if (grafico) grafico.destroy();
    grafico = new Chart($('graf-anos'), {
      data: {
        labels: estado.anos.map(String),
        datasets: [
          barra('Tributos antigos remanescentes', pct('legado'), paleta.legado),
          barra('CBS', novos('cbs'), paleta.cbs),
          barra('IBS', novos('ibs'), paleta.ibs),
          barra('Imposto Seletivo', novos('is'), paleta.is),
          { type: 'line', label: 'Carga atual', data: pct('carga_atual'), borderColor: corVar('--texto'), borderDash: [6, 4], borderWidth: 2, pointRadius: 4, pointBackgroundColor: corVar('--texto'), fill: false },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { color: texto, usePointStyle: true } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtN.format(c.parsed.y)}%`, footer: (itens) => `Carga nova: ${fmtN.format(itens.filter((i) => i.dataset.type === 'bar').reduce((a, i) => a + i.parsed.y, 0))}%` } },
        },
        scales: {
          x: { stacked: true, ticks: { color: texto }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { color: texto, callback: (v) => `${v}%` }, grid: { color: grade }, border: { display: false } },
        },
      },
    });
  }

  // ---------------- exportação ----------------
  function exportar() {
    const wb = XLSX.utils.book_new();
    const anoSel = +$('sel-ano').value;

    const resumo = [['ano', 'receita_bruta', 'carga_atual', 'carga_atual_%', 'tributos_antigos', 'cbs', 'ibs', 'is', 'carga_nova', 'carga_nova_%', 'variacao_pp', 'receita_liquida_atual', 'receita_liquida_nova', 'margem_bruta_atual_%', 'margem_bruta_nova_%', 'reajuste_necessario_%', 'itens_calculados', 'itens_com_inconsistencia']];
    estado.anos.forEach((ano) => {
      const d = metricasDoAno(ano);
      const ok = d.filter((x) => x.m.calculado);
      const s = R.somar(ok.map((x) => x.m));
      resumo.push([ano, s.receita_bruta, s.carga_atual, s.pct_atual, s.legado, s.cbs, s.ibs, s.is, s.carga_nova, s.pct_nova, s.pct_nova - s.pct_atual, s.rl_atual, s.rl_nova, s.mb_atual_pct, s.mb_nova_pct, s.reajuste_pct, ok.length, d.length - ok.length].map(arred));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumo), 'Resumo_Anos');

    [['sku', 'Por_SKU'], ['cliente', 'Por_Cliente'], ['canal', 'Por_Canal'], ['uf', 'Por_UF'], ['cclasstrib', 'Por_cClassTrib']].forEach(([dim, aba]) => {
      const linhas = [[dim, 'itens', 'receita_bruta', 'carga_atual_%', `carga_${anoSel}_%`, 'variacao_pp', 'variacao_carga', 'cbs', 'ibs', 'is', 'tributos_antigos', 'margem_atual_%', 'margem_nova_%', 'reajuste_%']];
      agrupar(metricasDoAno(anoSel), dim).forEach(({ chave, s }) => linhas.push([chave, s.itens, s.receita_bruta, s.pct_atual, s.pct_nova, s.pct_nova - s.pct_atual, s.variacao_carga, s.cbs, s.ibs, s.is, s.legado, s.mb_atual_pct, s.mb_nova_pct, s.reajuste_pct].map(arred)));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), `${aba}_${anoSel}`.slice(0, 31));
    });

    const itens = [['ano', 'linha', 'id_operacao', 'sku', 'descricao', 'cliente', 'canal', 'uf', 'municipio_ibge', 'ncm', 'nbs', 'cst', 'cclasstrib', 'origem_cclasstrib', 'situacao', 'base_cbs_ibs', 'reducao_cbs_%', 'cbs', 'ibs_uf', 'ibs_mun', 'is', 'tributos_antigos', 'receita_bruta', 'carga_atual', 'carga_nova', 'receita_liquida_atual', 'receita_liquida_nova', 'custo', 'margem_atual', 'margem_nova', 'reajuste_%']];
    estado.anos.forEach((ano) => {
      metricasDoAno(ano).forEach(({ l, r, m }) => {
        itens.push([ano, l._linha, l.id_operacao, l.sku, l.descricao, l.cliente, l.canal, l.uf, l.municipio_ibge, l.ncm, l.nbs, l.cst, l.cclasstrib, l.origem_cclasstrib, r ? r.estado : '',
          r ? r.vBC : null, r ? r.pRedCBS : null, r ? r.vCBS : null, r ? r.vIBSUF : null, r ? r.vIBSMun : null, r ? r.vIS : null, m.legado, m.receita_bruta, m.carga_atual, m.calculado ? m.carga_nova : null,
          m.rl_atual, m.calculado ? m.rl_nova : null, m.custo, m.margem_atual, m.calculado ? m.margem_nova : null, m.calculado ? m.reajuste_pct : null].map(arred));
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(itens), 'Itens');

    const inc = [['ano', 'linha', 'id_operacao', 'sku', 'situacao', 'codigo', 'campo', 'mensagem']];
    estado.anos.forEach((ano) => listaErros(metricasDoAno(ano)).forEach((e) => inc.push([ano, e.linha, e.operacao, e.sku, e.estado, e.codigo, e.campo, e.mensagem])));
    estado.problemas.forEach((p) => inc.push(['validação', p.linha, '', '', p.tipo, '', p.coluna, p.mensagem]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inc), 'Inconsistencias');

    const prem = [R.COLUNAS_PREMISSAS.map(([c]) => c), ...estado.premissas.map((p) => R.COLUNAS_PREMISSAS.map(([c]) => (p[c] === null ? 'oficial' : p[c])))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prem), 'Premissas');

    const v = estado.versao || {};
    const meta = [
      ['campo', 'valor'],
      ['gerado_em', new Date().toLocaleString('pt-BR')],
      ['arquivo_de_entrada', estado.arquivo],
      ['versao_calculadora_oficial', v.versaoApp],
      ['versao_tabelas', v.versaoDb],
      ['descricao_versao_tabelas', v.descricaoVersaoDb],
      ['data_versao_tabelas', v.dataVersaoDb],
      ['commit_calculadora', estado.pacote ? estado.pacote.commit_calculadora : ''],
      ['pacote_simulador', estado.pacote ? estado.pacote.pacote : ''],
      ['fonte', 'https://github.com/ReceitaFederal/calculadora-rtc-regime-regular'],
      ['premissa', 'Preço ao cliente mantido; CBS/IBS/IS pela calculadora oficial; alíquotas 2027+ são premissas informadas (cálculo simulado); sem créditos de compras.'],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), 'Metadados');
    if (estado.descobertas.length) abasRacional(wb);

    XLSX.writeFile(wb, `resultado_simulador_rtc_${hoje()}.xlsx`);
  }

  function arred(v) { return typeof v === 'number' && isFinite(v) ? R.r2(v) : v === null || v === undefined || (typeof v === 'number' && !isFinite(v)) ? '' : v; }

  // ---------------- descoberta pela NCM/NBS ----------------
  let motor;
  function motorDescoberta() {
    if (!motor) motor = Descoberta.criar({ requisitar, emParalelo, concorrencia: CONCORRENCIA });
    return motor;
  }

  function codigoItem(codigoBruto, rotulo) {
    const d = String(codigoBruto ?? '').replace(/\D/g, '');
    if (d.length === 8 || (d.length === 7 && typeof codigoBruto === 'number')) return { tipo: 'NCM', codigo: d.padStart(8, '0'), rotulo };
    if (d.length === 9) return { tipo: 'NBS', codigo: d, rotulo };
    return null;
  }

  function lerCodigosColados(texto) {
    return String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [cod, ...resto] = l.split(/[;\t]/);
      return codigoItem(cod.trim(), resto.join(' ').trim()) || { tipo: '?', codigo: cod.trim(), rotulo: resto.join(' ').trim(), invalido: true };
    });
  }

  async function descobrirDaPlanilha(arquivo) {
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array' });
    let itens = [];
    for (const nome of wb.SheetNames) {
      const linhas = linhasDaAba(wb.Sheets[nome]);
      if (!linhas.length || !('ncm' in linhas[0] || 'nbs' in linhas[0])) continue;
      itens = linhas.map((l) => codigoItem(l.ncm || l.nbs, l.descricao || l.sku || '')).filter(Boolean);
      break;
    }
    if (!itens.length) { alert('Não encontrei uma coluna "ncm" (ou "nbs") com códigos válidos na planilha.'); return; }
    $('desc-codigos').value = itens.map((i) => (i.rotulo ? `${i.codigo};${i.rotulo}` : i.codigo)).join('\n');
    descobrirCodigos(itens);
  }

  async function descobrirCodigos(itens) {
    if (!itens.length) { alert('Cole pelo menos uma NCM (8 dígitos) ou NBS (9 dígitos).'); return; }
    const validos = itens.filter((i) => !i.invalido);
    const btn = $('btn-descobrir');
    btn.disabled = true;
    $('desc-progresso').hidden = false;
    const prog = (f, t) => { $('desc-barra').style.width = `${Math.round((f / Math.max(t, 1)) * 100)}%`; $('desc-texto').textContent = `${f}/${t} códigos`; };
    $('desc-texto').textContent = 'Lendo os anexos da calculadora oficial…';
    const mapa = await motorDescoberta().descobrirLista(validos, DATA_DESCOBERTA, prog);
    const rotulos = new Map(itens.map((i) => [`${i.tipo}|${i.codigo}`, i.rotulo]));
    estado.descobertas = [
      ...itens.filter((i) => i.invalido).map((i) => ({ tipo: 'Código', codigo: i.codigo, rotulo: i.rotulo, erro: 'não tem 8 dígitos (NCM) nem 9 (NBS)' })),
      ...[...mapa.values()].map((r) => ({ ...r, rotulo: rotulos.get(`${r.tipo}|${r.codigo}`) || '' })),
    ];
    btn.disabled = false;
    $('desc-progresso').hidden = true;
    renderDescobertas();
  }

  // completa cst/cclasstrib (e IS) das linhas da planilha que só têm NCM/NBS
  async function completarPelaNcm(cruas) {
    const vazio = (v) => v === undefined || v === null || String(v).trim() === '';
    const pend = cruas.filter((b) => vazio(b.cclasstrib) && vazio(b.cst) && (!vazio(b.ncm) || !vazio(b.nbs)));
    if (!pend.length) return;
    const itemDe = (b) => codigoItem(!vazio(b.ncm) ? b.ncm : b.nbs, b.descricao || b.sku || '');
    const itens = pend.map(itemDe).filter(Boolean);
    const mapa = await motorDescoberta().descobrirLista(itens, DATA_DESCOBERTA, (f, t) => {
      $('soltar-texto').textContent = `Descobrindo a cClassTrib pela NCM/NBS na calculadora oficial… ${f}/${t}`;
    });
    pend.forEach((b) => {
      const it = itemDe(b);
      const r = it && mapa.get(`${it.tipo}|${it.codigo}`);
      if (!r || r.erro) return;
      b.cst = r.sugestao.cst;
      b.cclasstrib = r.sugestao.codigo;
      b.__origem_cclasstrib = r.sugestao.situacao === 'REVISAR' ? 'descoberta – revisar' : 'descoberta';
      if (r.is && vazio(b.is_cst)) {
        b.is_cst = r.is.cst; b.is_cclasstrib = r.is.cclasstrib;
        if (r.is.aliquota !== null && vazio(b.is_aliquota)) b.is_aliquota = r.is.aliquota;
      }
    });
    estado.descobertas = [...mapa.values()].map((r) => ({ ...r, rotulo: '' }));
    renderDescobertas();
  }

  const ROTULO_SITUACAO = { AUTOMATICA: 'Automática', REVISAR: 'Revisar', INTEGRAL: 'Integral', ERRO: 'Erro' };
  const ORDEM_SITUACAO = { REVISAR: 0, ERRO: 1, AUTOMATICA: 2, INTEGRAL: 3 };
  const prem = (ano) => estado.premissas.find((p) => p.ano === ano);

  function renderDescobertas() {
    const lista = [...estado.descobertas].sort((a, b) => ORDEM_SITUACAO[a.erro ? 'ERRO' : a.sugestao.situacao] - ORDEM_SITUACAO[b.erro ? 'ERRO' : b.sugestao.situacao]);
    const resumo = {};
    lista.forEach((r) => { const k = r.erro ? 'ERRO' : r.sugestao.situacao; resumo[k] = (resumo[k] || 0) + 1; });
    let h = `<p>${lista.length} código(s): ${Object.entries(resumo).map(([k, v]) => `<span class="etiqueta ${k}">${ROTULO_SITUACAO[k]} ${v}</span>`).join(' ')}</p>`;
    lista.forEach((r) => {
      const situ = r.erro ? 'ERRO' : r.sugestao.situacao;
      const rac = R.racional(r, estado.premissas);
      const c = r.erro ? null : r.sugestao.classificacao;
      const ef = r.erro ? null : R.aliquotaEfetiva(c, prem(2033));
      h += `<details class="desc-item" ${situ === 'REVISAR' || situ === 'ERRO' ? 'open' : ''}><summary>
        <span class="desc-cod">${esc(r.codigo)}<div class="desc-sub">${esc(r.tipo)}</div></span>
        <span>${esc(r.descricao || r.rotulo || '')}${r.rotulo && r.descricao ? `<div class="desc-sub">${esc(r.rotulo)}</div>` : ''}</span>
        <span>${r.erro ? '–' : `cClassTrib <b>${r.sugestao.codigo}</b><div class="desc-sub">CST ${r.sugestao.cst} · redução ${fmtN.format(c ? c.percentualReducaoCbs : 0)}%</div>`}</span>
        <span>${r.erro ? '' : `Efetiva 2033 <b>${fmtP(ef)}</b><div class="desc-sub">${r.is ? 'Sujeito ao IS' : 'Sem IS'}</div>`}</span>
        <span class="etiqueta ${situ}">${ROTULO_SITUACAO[situ]}</span>
      </summary><div class="desc-corpo"><b>Racional</b><ol>${rac.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>`;
      if (rac.alternativas.length) {
        h += '<b>Alternativas</b><div class="tabela-rolagem"><table class="tabela"><thead><tr><th>cClassTrib</th><th>CST</th><th>Descrição</th><th class="num">Redução</th><th class="num">Efetiva 2033</th><th>Base legal</th><th>Por que não foi a sugerida</th></tr></thead><tbody>' +
          rac.alternativas.map((a) => `<tr><td>${a.codigo}</td><td>${a.cst}</td><td>${esc(a.descricao)}</td><td class="num">${fmtN.format(a.reducao)}%</td><td class="num">${fmtP(a.efetiva_2033)}</td><td>${esc(a.base_legal)}</td><td>${esc(a.motivo)}</td></tr>`).join('') +
          '</tbody></table></div>';
      }
      h += '</div></details>';
    });
    $('desc-lista').innerHTML = h;
    $('desc-resultado').hidden = !lista.length;
  }

  function abasRacional(wb) {
    const rac = [['tipo', 'codigo', 'descricao_oficial', 'descricao_informada', 'situacao', 'cclasstrib_sugerida', 'cst', 'tratamento', 'reducao_cbs_%', 'reducao_ibs_uf_%', 'reducao_ibs_mun_%', 'aliquota_efetiva_2027_%', 'aliquota_efetiva_2033_%', 'base_legal', 'imposto_seletivo', 'credito_adquirente', 'racional']];
    const alt = [['tipo', 'codigo', 'cclasstrib_sugerida', 'alternativa', 'cst', 'descricao', 'reducao_%', 'aliquota_efetiva_2033_%', 'base_legal', 'por_que_nao_foi_a_sugerida']];
    estado.descobertas.forEach((r) => {
      const x = R.racional(r, estado.premissas);
      if (r.erro) { rac.push([r.tipo, r.codigo, '', r.rotulo, 'ERRO', '', '', '', '', '', '', '', '', '', '', '', x.passos.join('\n')]); return; }
      const c = r.sugestao.classificacao;
      const ef = (a) => { const v = R.aliquotaEfetiva(c, prem(a)); return v === null ? '' : R.r2(v * 100) / 100; };
      rac.push([r.tipo, r.codigo, r.descricao, r.rotulo, ROTULO_SITUACAO[r.sugestao.situacao], r.sugestao.codigo, r.sugestao.cst, c ? c.descricaoTratamentoTributario : 'Tributação integral',
        c ? c.percentualReducaoCbs : 0, c ? c.percentualReducaoIbsUf : 0, c ? c.percentualReducaoIbsMun : 0, ef(2027), ef(2033),
        c && c._fund ? `${c._fund.textoCurto} – ${c._fund.texto}` : 'LC 214/2025 (regra geral)', r.is ? 'Sim' : 'Não',
        c ? `CBS ${c.indicaApropriacaoCreditoAdquirenteCbs ? 'sim' : 'não'} / IBS ${c.indicaApropriacaoCreditoAdquirenteIbs ? 'sim' : 'não'}` : '', x.passos.join('\n')]);
      x.alternativas.forEach((a) => alt.push([r.tipo, r.codigo, r.sugestao.codigo, a.codigo, a.cst, a.descricao, a.reducao, a.efetiva_2033, a.base_legal, a.motivo]));
    });
    const wsR = XLSX.utils.aoa_to_sheet(rac);
    wsR['!cols'] = [6, 11, 50, 25, 11, 12, 6, 25, 9, 9, 9, 11, 11, 60, 8, 18, 120].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsR, 'Racional_cClassTrib');
    const wsA = XLSX.utils.aoa_to_sheet(alt);
    wsA['!cols'] = [6, 11, 12, 11, 6, 70, 10, 12, 12, 70].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsA, 'Alternativas');
  }

  async function exportarDescobertas() {
    await garantirClassificacoes();
    const itens = estado.descobertas.filter((r) => !r.erro).map((r) => ({
      sku: r.rotulo || r.codigo,
      descricao: r.descricao,
      ncm: r.tipo === 'NCM' ? r.codigo : '',
      nbs: r.tipo === 'NBS' ? r.codigo : '',
      cst: r.sugestao.cst,
      cclasstrib: r.sugestao.codigo,
      is_cst: r.is ? r.is.cst : '',
      is_cclasstrib: r.is ? r.is.cclasstrib : '',
      is_aliquota: r.is && r.is.aliquota !== null ? r.is.aliquota : '',
      quantidade: 1,
    }));
    const wb = montarModelo(itens);
    abasRacional(wb);
    XLSX.writeFile(wb, `descoberta_cclasstrib_${hoje()}.xlsx`);
  }


  iniciar();
})();
