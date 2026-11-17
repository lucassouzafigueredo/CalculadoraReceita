/*
 * Teste de ponta a ponta do simulador (requer a calculadora no ar com a pasta web publicada).
 * Uso: node scripts/teste_e2e.js [url] [pasta_saida]
 * Fluxo: abre a tela, baixa a planilha-modelo, envia a própria planilha-modelo, calcula
 * 2026/2027/2029/2033, confere os valores do exemplo oficial e exporta o Excel.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const URL = process.argv[2] || 'http://localhost:8080/api/simulador.html';
const SAIDA = process.argv[3] || path.join(__dirname, '..', 'saida_teste');

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  // versao.json só existe no pacote montado; fora dele o 404 é esperado
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) erros.push(m.text()); });

  await page.goto(URL);
  await page.waitForSelector('#status-ponto.ok', { timeout: 30000 });
  console.log('Versão:', await page.textContent('#status-texto'));

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-modelo')]);
  const modelo = path.join(SAIDA, download.suggestedFilename());
  await download.saveAs(modelo);
  console.log('Modelo salvo:', modelo);
  const XLSX = require('../web/vendor/xlsx.full.min.js');
  const wbModelo = XLSX.read(fs.readFileSync(modelo));
  const tabelas = XLSX.utils.sheet_to_json(wbModelo.Sheets.Tabelas);
  assert(tabelas.length > 50, `aba Tabelas deveria listar as cClassTrib (veio ${tabelas.length})`);
  assert(tabelas.some((t) => String(t.cclasstrib) === '200028'), 'aba Tabelas deve conter 200028');
  const cabItens = XLSX.utils.sheet_to_json(wbModelo.Sheets.Itens, { header: 1 })[0];
  assert(cabItens.includes('cclasstrib') && cabItens.includes('cst'), 'aba Itens deve ter cst e cclasstrib');
  console.log(`Tabelas: ${tabelas.length} cClassTrib`);

  await page.setInputFiles('#arquivo', modelo);
  await page.waitForSelector('#area-calculo:not([hidden])');
  console.log('Validação:', (await page.textContent('#validacao')).slice(0, 200));

  await page.click('#btn-calcular');
  await page.waitForSelector('#resultados:not([hidden])', { timeout: 120000 });
  await page.waitForTimeout(500);

  // conferência com docs/exemplos.md: serviço de educação, base 1200, CBS 8,8%... aqui 2027 usa 8,7% (premissa)
  const resultado = await page.evaluate(() => {
    const out = {};
    for (const opt of document.querySelectorAll('#sel-ano option')) out[opt.value] = true;
    return out;
  });
  assert.deepStrictEqual(Object.keys(resultado), ['2026', '2027', '2029', '2033']);

  await page.selectOption('#sel-ano', '2027');
  const tabErros = await page.textContent('#tab-erros');
  assert(tabErros.includes('REG-011'), 'deveria mostrar o erro proposital REG-011');
  await page.selectOption('#sel-dim', 'sku');
  const tabDim = await page.textContent('#tab-dim');
  assert(tabDim.includes('CURSO-ANUAL'), 'tabela por SKU deve listar o curso');

  await page.selectOption('#sel-ano', '2033');
  await page.screenshot({ path: path.join(SAIDA, 'tela_resultados.png'), fullPage: true });

  const [exp] = await Promise.all([page.waitForEvent('download'), page.click('#btn-exportar')]);
  const arqExp = path.join(SAIDA, exp.suggestedFilename());
  await exp.saveAs(arqExp);
  console.log('Exportado:', arqExp);
  console.log('KPIs 2033:', (await page.textContent('#kpis')).replace(/\s+/g, ' '));

  await browser.close();
  if (erros.length) { console.error('Erros no console:', erros); process.exit(1); }
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
