/*
 * Confere o MODO ONLINE (web/js/api_offline.js + retrato das tabelas) contra a calculadora oficial.
 * 1) Para cada cClassTrib, calcula um item em 2026/2027/2030/2033 nos dois e marca como "suportada"
 *    só se bater ao centavo em todos os anos.
 * 2) Regressão aleatória (bases, anos, IS, base unificada) nas suportadas: qualquer diferença = falha.
 * Uso: node scripts/conferir_online.js <dados.json> <url_api> <saida_dados_online.json>
 */
const path = require('path');
const fs = require('fs');
const D = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf-8'));
const API = process.argv[3];
const SAIDA = process.argv[4];
const { criarMotor } = require('../ferramentas/teste_rapido/motor_rapido.js');
const { criarApiOffline } = require('../web/js/api_offline.js');
const R = require('../web/js/regras.js');
const M = criarMotor(D);

let semente = 42;
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const ALIQ = { 2027: [8.7, 0.05, 0.05], 2030: [8.8, 2.98, 0.56], 2033: [8.8, 14.9, 2.8] };

async function oficial(rota, corpo) {
  const r = await fetch(API + rota, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  return r.json();
}
function resumo(o) {
  if (!o) return 'nada';
  const t = o.tribCalc || {}; const g = (t.IBSCBS || {}).gIBSCBS || {};
  const calc = o.estadoItem === 'CALCULADO' || o.estadoItem === 'CALCULO_SIMULADO';
  return JSON.stringify(calc ? [o.estadoItem, g.vBC, (g.gCBS || {}).vCBS, (g.gIBSUF || {}).vIBSUF, (g.gIBSMun || {}).vIBSMun, (t.IS || {}).vIS || null]
    : [o.estadoItem, (o.erros || []).map((e) => e.code).join(',')]);
}
function operacao(ano, itens) {
  return { id: `c-${ano}`, versao: '1.0.0', dhFatoGerador: `${ano}-06-15T12:00:00-03:00`, municipio: 3550308, uf: 'SP', itens: itens.map((it, i) => ({ ...it, numero: i + 1 })) };
}
function comAliquotas(it, ano) {
  if (ano < 2027) return it;
  const [cbs, uf, mun] = ALIQ[ano] || ALIQ[2033];
  const a = { cbs, ibsEstadual: uf, ibsMunicipal: mun };
  if (it.impostoSeletivo) a.impostoSeletivo = { adValorem: it._isAliq };
  const { _isAliq, ...resto } = it;
  return { ...resto, aliquotasNominais: a };
}
async function comparar(ano, itens, emul) {
  const op = operacao(ano, itens.map((i) => comAliquotas(i, ano)));
  const [ofi, emu] = [await oficial('/observabilidade/regime-geral', op), emul.regimeGeral(JSON.parse(JSON.stringify(op)))];
  const objs = ofi.objetos || [];
  return op.itens.map((it, i) => ({ it, ofi: resumo(objs[i]), emu: resumo(emu.objetos[i]) }));
}

function codigoValido(c) {
  const data = '2027-01-01';
  const pick = (regras, tabela, tam) => {
    const rs = regras.filter((r) => r.c === c.codigo);
    if (!rs.length) return null;
    for (const r of rs) for (const cod of Object.keys(tabela)) if (cod.length === tam && cod.startsWith(r.p) && M.valido(cod, c.codigo, data, regras)) return cod;
    return undefined; // tem anexo mas nenhum código válido
  };
  const ncm = pick(D.regrasNcm, D.ncm, 8);
  if (ncm) return { ncm };
  const nbs = pick(D.regrasNbs, D.nbs, 9);
  if (nbs) return { nbs };
  if (ncm === undefined || nbs === undefined) return null;
  const nom = c.nomenclatura || '';
  if (nom.includes('NCM')) return { ncm: '84713012' };
  if (nom.includes('NBS')) return { nbs: '101011100' };
  return { ncm: '84713012' };
}

(async () => {
  const todas = criarApiOffline({ ...D, suportadas: D.classes.map((c) => c.codigo) }, criarMotor);
  // 1) sondagem por classificação
  const suportadas = [];
  const fora = [];
  for (const c of D.classes) {
    const cod = codigoValido(c);
    if (!cod) { fora.push(`${c.codigo} (sem código de teste)`); continue; }
    const item = { ...cod, cst: c.codigo.slice(0, 3), cClassTrib: c.codigo, baseCalculo: 1234.56, quantidade: 1, unidade: 'UN' };
    let okClasse = true;
    for (const ano of [2026, 2027, 2030, 2033]) {
      const [r] = await comparar(ano, [item], todas);
      const calc = r.ofi.includes('CALCUL');
      if (!calc || r.ofi !== r.emu) { okClasse = false; break; }
    }
    (okClasse ? suportadas : fora).push(c.codigo);
  }
  console.log(`modo online: ${suportadas.length} de ${D.classes.length} cClassTrib batem ao centavo com a calculadora oficial`);

  // 2) regressão aleatória nas suportadas
  const emul = criarApiOffline({ ...D, suportadas }, criarMotor);
  const ncmIS = Object.keys(D.ncm).filter((c) => c.length === 8 && D.isNcm.some((r) => c.startsWith(r[0])));
  const candidatos = [];
  const ncm8 = Object.keys(D.ncm).filter((c) => c.length === 8);
  for (let i = 0; i < 250; i++) {
    const ncm = ncm8[Math.floor(rnd() * ncm8.length)];
    const aceitas = M.classesComAnexo(D.regrasNcm, '2027-01-01').filter((cc) => M.valido(ncm, cc, '2027-01-01', D.regrasNcm)).map((cc) => D.classes.find((x) => x.codigo === cc));
    const s = R.sugerirClassificacao(aceitas);
    if (!suportadas.includes(s.codigo)) continue;
    candidatos.push({ ncm, cst: s.cst, cClassTrib: s.codigo, baseCalculo: Math.round(rnd() * 5000000) / 100, quantidade: 1, unidade: 'UN' });
  }
  for (let i = 0; i < 60; i++) {
    const ncm = ncmIS[Math.floor(rnd() * ncmIS.length)];
    const comBase = rnd() < 0.5;
    const baseIS = Math.round(rnd() * 100000) / 100;
    candidatos.push({ ncm, cst: '000', cClassTrib: '000001', ...(comBase ? { baseCalculo: Math.round(rnd() * 100000) / 100 } : {}), quantidade: 1, unidade: 'UN',
      impostoSeletivo: { cst: '000', cClassTrib: '000001', baseCalculo: baseIS, quantidade: 1, unidade: 'UN' }, _isAliq: Math.round(rnd() * 3000) / 100 });
  }
  const dif = [];
  let total = 0;
  for (const ano of [2026, 2027, 2029, 2030, 2033]) {
    for (let i = 0; i < candidatos.length; i += 25) {
      const lote = candidatos.slice(i, i + 25).filter((c) => ano >= 2027 || !c.impostoSeletivo);
      if (!lote.length) continue;
      (await comparar(ano, lote, emul)).forEach((r) => { total++; if (r.ofi !== r.emu) dif.push({ ano, item: r.it, oficial: r.ofi, online: r.emu }); });
    }
  }
  // base unificada
  for (let i = 0; i < 200; i++) {
    const b = { anoFatoGerador: 2026 + Math.floor(rnd() * 8), tipoDocumento: 55, natureza: rnd() < 0.7 ? 'bem' : 'servico' };
    ['vProd', 'vFrete', 'vSeg', 'vOutro', 'vDesc', 'vIS', 'vPIS', 'vCOFINS', 'vICMS', 'vISSQN'].forEach((k) => { b[k] = Math.round(rnd() * 100000) / 100; });
    const o = await oficial('/base-calculo/base-calculo-unificada', b);
    const e = emul.baseUnificada(b);
    total++;
    if (Math.abs(o.baseRG - e.baseRG) > 1e-6 || Math.abs(o.baseIS - e.baseIS) > 1e-6) dif.push({ base: b, oficial: [o.baseRG, o.baseIS], online: [e.baseRG, e.baseIS] });
  }
  console.log(`modo online x calculadora oficial: ${total} comparações, ${dif.length} divergência(s)`);
  if (dif.length) { const g = {}; dif.forEach((d) => { const k = `${d.oficial} x ${String(d.online).slice(0, 40)}`; g[k] = (g[k] || 0) + 1; }); console.error(g); console.error(JSON.stringify(dif.slice(0, 3), null, 1)); process.exit(1); }
  if (suportadas.length < 50) { console.error('Poucas classificações suportadas: algo mudou na calculadora oficial'); process.exit(1); }
  fs.writeFileSync(SAIDA, JSON.stringify({ ...D, suportadas, conferido: { comparacoes: total, classes: suportadas.length, em: new Date().toISOString() } }));
  console.log('fora do modo online:', fora.join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
